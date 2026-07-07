import { describe, expect, it } from 'vitest'

import { totalChipsInPlay } from './invariants'
import { recordRebuy } from './rebuy'
import { applyGameCommand } from './reducers/game-reducer'
import { cancelHand, startHand } from './reducers/hand-reducer'
import { updateBlinds } from './settings'
import { mustOk, played, runOutToShowdown, startedHand } from './testing'
import { makeBetweenHandsSnapshot } from './state/fixtures'
import { makeChips } from '../shared/chips'

// Cancel hand (SPEC.md): returns every commitment including posted blinds,
// voids the hand with no pots awarded, and does not advance the button. The
// next hand re-posts blinds from the same positions.

describe('cancelHand', () => {
  it('refunds posted blinds and returns to between-hands', () => {
    const s = startedHand({ playerCount: 3 })
    const result = mustOk(cancelHand(s), 'cancel')

    expect(result.snapshot.game.status).toBe('between-hands')
    expect(result.snapshot.hand).toBeNull()
    expect(result.snapshot.pots).toEqual([])
    for (const player of result.snapshot.players) {
      expect(player.stack).toBe(1000)
      expect(player.handStatus).toBe('waiting')
    }
    expect(result.events).toEqual([{ _tag: 'hand-cancelled' }])
  })

  it('refunds mid-street bets and folded commitments alike', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'raise', amount: 300 })
    s = played(s, 1, { kind: 'call' })
    const before = totalChipsInPlay(s)

    const result = mustOk(cancelHand(s), 'cancel')
    expect(totalChipsInPlay(result.snapshot)).toBe(before)
    for (const player of result.snapshot.players) {
      expect(player.stack).toBe(1000)
    }
  })

  it('does not advance the button: the next hand re-posts the same positions', () => {
    const s = startedHand({ playerCount: 3, dealerSeat: 0 })
    const originalHand = s.hand!
    const cancelled = mustOk(cancelHand(s), 'cancel').snapshot

    expect(cancelled.game.dealerSeat).toBe(0)
    expect(cancelled.game.lastHandNumber).toBe(0)

    const next = mustOk(startHand(cancelled, 'hand_2'), 'restart').snapshot
    expect(next.hand!.dealerSeat).toBe(originalHand.dealerSeat)
    expect(next.hand!.smallBlindSeat).toBe(originalHand.smallBlindSeat)
    expect(next.hand!.bigBlindSeat).toBe(originalHand.bigBlindSeat)
    expect(next.hand!.handNumber).toBe(originalHand.handNumber)
  })

  it('applies pending settings: the re-posted hand is a next hand', () => {
    let s = startedHand({ playerCount: 3 })
    s = mustOk(updateBlinds(s, makeChips(100), makeChips(200)), 'blinds').snapshot
    expect(s.game.settings.smallBlind).toBe(50)

    const cancelled = mustOk(cancelHand(s), 'cancel').snapshot
    expect(cancelled.game.settings.smallBlind).toBe(100)
    expect(cancelled.game.settings.bigBlind).toBe(200)
    expect(cancelled.game.pendingSettings).toBeNull()
  })

  it('credits pending mid-hand rebuys on cancel', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    const folded = s.players.find((p) => p.seatIndex === 0)!
    s = mustOk(
      recordRebuy(s, folded.id, { currency: 'EUR', cents: 500 }, 500),
      'rebuy',
    ).snapshot
    expect(s.players.find((p) => p.seatIndex === 0)!.pendingRebuyChips).toBe(500)

    const cancelled = mustOk(cancelHand(s), 'cancel').snapshot
    const restored = cancelled.players.find((p) => p.seatIndex === 0)!
    expect(restored.stack).toBe(1500)
    expect(restored.pendingRebuyChips).toBe(0)
  })

  it('honors sit-out requests when statuses reset', () => {
    let s = startedHand({ playerCount: 3 })
    s = {
      ...s,
      players: s.players.map((p) =>
        p.seatIndex === 2 ? { ...p, sitOutNextHand: true } : p,
      ),
    }
    const cancelled = mustOk(cancelHand(s), 'cancel').snapshot
    expect(cancelled.players.find((p) => p.seatIndex === 2)!.handStatus).toBe(
      'sitting-out',
    )
  })

  it('rejects at showdown: awarded pots are indistinguishable from side pots', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'call' })
    s = played(s, 1, { kind: 'call' })
    s = played(s, 2, { kind: 'check' })
    s = runOutToShowdown(s)

    const result = cancelHand(s)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error._tag).toBe('InvalidAction')
      expect(JSON.stringify(result.error)).toContain('undo')
    }
  })

  it('rejects when no hand is active', () => {
    const s = makeBetweenHandsSnapshot({ playerCount: 3 })
    expect(cancelHand(s).ok).toBe(false)
  })

  it('is dispatched by the game reducer', () => {
    const s = startedHand({ playerCount: 3 })
    const result = applyGameCommand(s, { _tag: 'cancel-hand' }, { actingSeat: 0 })
    expect(result.ok).toBe(true)
  })
})
