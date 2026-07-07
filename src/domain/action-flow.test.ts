import { describe, expect, it } from 'vitest'

import { totalChipsInPlay } from './invariants'
import { applyPlayerAction, type PlayerAction } from './reducers/action-reducer'
import { confirmNextStreet, startHand } from './reducers/hand-reducer'
import { makeBetweenHandsSnapshot } from './state/fixtures'
import type { GameSnapshot } from './state/types'

function expectOk<T extends { ok: boolean }>(result: T) {
  expect(result.ok, JSON.stringify(result)).toBe(true)
  return result as Extract<T, { ok: true }>
}

// 3 players, dealer 0, SB 1 (50), BB 2 (100), first actor 0, 1000 stacks.
function freshHand(): GameSnapshot {
  const snapshot = makeBetweenHandsSnapshot({ playerCount: 3, dealerSeat: 0 })
  return expectOk(startHand(snapshot, 'hand_1')).snapshot
}

function act(
  snapshot: GameSnapshot,
  seatIndex: number,
  action: PlayerAction,
): GameSnapshot {
  return expectOk(applyPlayerAction(snapshot, seatIndex, action)).snapshot
}

describe('turn ownership', () => {
  it('rejects actions from a non-active seat', () => {
    const snapshot = freshHand()
    const result = applyPlayerAction(snapshot, 1, { kind: 'fold' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error._tag).toBe('NotActivePlayer')
  })
})

describe('turn advancement and street closure', () => {
  it('advances the actor after fold, call, and check', () => {
    let s = freshHand()
    s = act(s, 0, { kind: 'call' })
    expect(s.hand?.activeSeat).toBe(1)
    s = act(s, 1, { kind: 'call' })
    expect(s.hand?.activeSeat).toBe(2)
    // Big blind checks the option; betting closes, no auto street advance.
    s = act(s, 2, { kind: 'check' })
    expect(s.hand?.activeSeat).toBeNull()
    expect(s.hand?.nextStreetReady).toBe(true)
    expect(s.hand?.street).toBe('pre-flop')
  })

  it('conserves chips across every action', () => {
    let s = freshHand()
    const total = totalChipsInPlay(s)
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'raise', amount: 300 })
    s = act(s, 2, { kind: 'fold' })
    s = act(s, 0, { kind: 'call' })
    expect(totalChipsInPlay(s)).toBe(total)
  })

  it('refuses next-street confirmation while betting is open', () => {
    const s = freshHand()
    expect(confirmNextStreet(s).ok).toBe(false)
  })

  it('advances streets on confirmation with the correct post-flop first actor', () => {
    let s = freshHand()
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'call' })
    s = act(s, 2, { kind: 'check' })

    s = expectOk(confirmNextStreet(s)).snapshot
    expect(s.hand?.street).toBe('flop')
    expect(s.hand?.nextStreetReady).toBe(false)
    expect(s.hand?.currentBet).toBe(0)
    // Post-flop the first active seat after the dealer acts first.
    expect(s.hand?.activeSeat).toBe(1)
    // Street commitments reset; hand totals are preserved.
    const c = s.hand?.commitments.find((x) => x.seatIndex === 2)
    expect(c?.street).toBe(0)
    expect(c?.total).toBe(100)
  })

  it('requires check taps from every player to close a street with no bets', () => {
    let s = freshHand()
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'call' })
    s = act(s, 2, { kind: 'check' })
    s = expectOk(confirmNextStreet(s)).snapshot

    s = act(s, 1, { kind: 'check' })
    s = act(s, 2, { kind: 'check' })
    expect(s.hand?.nextStreetReady).toBe(false)
    s = act(s, 0, { kind: 'check' })
    expect(s.hand?.nextStreetReady).toBe(true)
  })

  it('supports bet, call, raise, fold through a flop street', () => {
    let s = freshHand()
    const total = totalChipsInPlay(s)
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'call' })
    s = act(s, 2, { kind: 'check' })
    s = expectOk(confirmNextStreet(s)).snapshot

    s = act(s, 1, { kind: 'bet', amount: 100 })
    expect(s.hand?.currentBet).toBe(100)
    s = act(s, 2, { kind: 'call' })
    s = act(s, 0, { kind: 'raise', amount: 300 })
    expect(s.hand?.currentBet).toBe(300)
    s = act(s, 1, { kind: 'fold' })
    s = act(s, 2, { kind: 'call' })
    expect(s.hand?.nextStreetReady).toBe(true)
    s = expectOk(confirmNextStreet(s)).snapshot
    expect(s.hand?.street).toBe('turn')
    expect(totalChipsInPlay(s)).toBe(total)
  })

  it('reaches showdown after the river closes', () => {
    let s = freshHand()
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'call' })
    s = act(s, 2, { kind: 'check' })
    for (const street of ['flop', 'turn', 'river'] as const) {
      s = expectOk(confirmNextStreet(s)).snapshot
      expect(s.hand?.street).toBe(street)
      s = act(s, 1, { kind: 'check' })
      s = act(s, 2, { kind: 'check' })
      s = act(s, 0, { kind: 'check' })
    }
    s = expectOk(confirmNextStreet(s)).snapshot
    expect(s.hand?.street).toBe('showdown')
    expect(s.game.status).toBe('showdown')
  })
})

describe('stack guards', () => {
  it('rejects bets above the player stack', () => {
    let s = freshHand()
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'call' })
    s = act(s, 2, { kind: 'check' })
    s = expectOk(confirmNextStreet(s)).snapshot
    const result = applyPlayerAction(s, 1, { kind: 'bet', amount: 5000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error._tag).toBe('InsufficientStack')
  })
})

describe('uncontested win', () => {
  it('auto-awards the pot to the last remaining player and advances the button', () => {
    let s = freshHand()
    const total = totalChipsInPlay(s)

    s = act(s, 0, { kind: 'fold' })
    const settled = expectOk(applyPlayerAction(s, 1, { kind: 'fold' }))

    const tags = settled.events.map((e) => e._tag)
    expect(tags).toContain('folded')
    expect(tags).toContain('pot-awarded')
    expect(tags).toContain('hand-settled')

    const next = settled.snapshot
    expect(next.game.status).toBe('between-hands')
    expect(next.hand).toBeNull()
    expect(next.game.dealerSeat).toBe(1)
    expect(next.game.lastHandNumber).toBe(1)

    // BB (seat 2) wins SB's 50 uncontested: 1000 - 100 + 150 = 1050.
    const winner = next.players.find((p) => p.seatIndex === 2)
    expect(winner?.stack).toBe(1050)
    expect(totalChipsInPlay(next)).toBe(total)
  })

  it('heads-up: big blind acts first on every post-flop street', () => {
    const snapshot = makeBetweenHandsSnapshot({ playerCount: 2, dealerSeat: 0 })
    let s = expectOk(startHand(snapshot, 'hand_1')).snapshot

    // Dealer/SB (seat 0) acts first pre-flop.
    expect(s.hand?.activeSeat).toBe(0)
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'check' })
    s = expectOk(confirmNextStreet(s)).snapshot

    // Big blind (seat 1) acts first on the flop.
    expect(s.hand?.street).toBe('flop')
    expect(s.hand?.activeSeat).toBe(1)
  })
})
