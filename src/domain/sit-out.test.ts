import { describe, expect, it } from 'vitest'

import { applyGameCommand } from './reducers/game-reducer'
import { startHand } from './reducers/hand-reducer'
import { returnFromSitOut, sitOut } from './sit-out'
import { mustOk, played, startedHand } from './testing'
import { makeBetweenHandsSnapshot } from './state/fixtures'

// Sit-out and return (SPEC.md): both take effect from the next hand — a
// contesting player finishes the current hand, and a returning player is
// dealt in with no missed-blind penalty.

describe('sitOut', () => {
  it('between hands: flags the seat and shows sitting-out immediately', () => {
    const s = makeBetweenHandsSnapshot({ playerCount: 3 })
    const result = mustOk(sitOut(s, 2), 'sit out')
    const player = result.snapshot.players.find((p) => p.seatIndex === 2)!
    expect(player.sitOutNextHand).toBe(true)
    expect(player.handStatus).toBe('sitting-out')
    expect(result.events).toEqual([{ _tag: 'sat-out', seatIndex: 2 }])
  })

  it('between hands: the next hand skips the seat for blinds and action', () => {
    const s = mustOk(sitOut(makeBetweenHandsSnapshot({ playerCount: 3 }), 1), 'sit out')
      .snapshot
    const started = mustOk(startHand(s, 'hand_1'), 'start').snapshot
    const hand = started.hand!
    expect([hand.dealerSeat, hand.smallBlindSeat, hand.bigBlindSeat]).not.toContain(1)
    expect(hand.commitments.map((c) => c.seatIndex)).toEqual([0, 2])
  })

  it('mid-hand: only flags — the player finishes the current hand', () => {
    const s = startedHand({ playerCount: 3 })
    const result = mustOk(sitOut(s, 0), 'sit out')
    const player = result.snapshot.players.find((p) => p.seatIndex === 0)!
    expect(player.sitOutNextHand).toBe(true)
    expect(player.handStatus).toBe('waiting')
    expect(result.snapshot.hand!.activeSeat).toBe(0)
  })

  it('rejects when already sitting out', () => {
    const s = mustOk(sitOut(makeBetweenHandsSnapshot({ playerCount: 3 }), 2), 'sit out')
      .snapshot
    expect(sitOut(s, 2).ok).toBe(false)
  })

  it('rejects an empty seat', () => {
    expect(sitOut(makeBetweenHandsSnapshot({ playerCount: 2 }), 7).ok).toBe(false)
  })
})

describe('returnFromSitOut', () => {
  it('between hands: clears the flag and deals the player into the next hand', () => {
    let s = mustOk(sitOut(makeBetweenHandsSnapshot({ playerCount: 3 }), 1), 'sit out')
      .snapshot
    s = mustOk(returnFromSitOut(s, 1), 'return').snapshot
    const player = s.players.find((p) => p.seatIndex === 1)!
    expect(player.sitOutNextHand).toBe(false)
    expect(player.handStatus).toBe('waiting')

    const started = mustOk(startHand(s, 'hand_1'), 'start').snapshot
    expect(started.hand!.commitments.map((c) => c.seatIndex)).toEqual([0, 1, 2])
  })

  it('emits a returned-from-sit-out audit event', () => {
    const s = mustOk(sitOut(makeBetweenHandsSnapshot({ playerCount: 3 }), 1), 'sit out')
      .snapshot
    const result = mustOk(returnFromSitOut(s, 1), 'return')
    expect(result.events).toEqual([{ _tag: 'returned-from-sit-out', seatIndex: 1 }])
  })

  it('a returning player with no chips still needs a rebuy', () => {
    const base = makeBetweenHandsSnapshot({
      playerCount: 3,
      playerOverrides: { 1: { stack: 0, handStatus: 'needs-rebuy' } },
    })
    const s = { ...base, players: base.players.map((p) =>
      p.seatIndex === 1 ? { ...p, sitOutNextHand: true, handStatus: 'sitting-out' as const } : p,
    ) }
    const result = mustOk(returnFromSitOut(s, 1), 'return')
    expect(result.snapshot.players.find((p) => p.seatIndex === 1)!.handStatus).toBe(
      'needs-rebuy',
    )
  })

  it('rejects when the player is not sitting out', () => {
    expect(returnFromSitOut(makeBetweenHandsSnapshot({ playerCount: 3 }), 1).ok).toBe(
      false,
    )
  })
})

describe('game reducer dispatch', () => {
  it('sit-out and return act on the acting seat and require one', () => {
    const between = makeBetweenHandsSnapshot({ playerCount: 3 })
    expect(
      applyGameCommand(between, { _tag: 'sit-out' }, { actingSeat: null }).ok,
    ).toBe(false)

    const satOut = applyGameCommand(between, { _tag: 'sit-out' }, { actingSeat: 2 })
    expect(satOut.ok).toBe(true)
    if (satOut.ok) {
      expect(
        satOut.snapshot.players.find((p) => p.seatIndex === 2)!.sitOutNextHand,
      ).toBe(true)
      const returned = applyGameCommand(
        satOut.snapshot,
        { _tag: 'return-from-sit-out' },
        { actingSeat: 2 },
      )
      expect(returned.ok).toBe(true)
    }
  })

  it('a sitting-out player finishes the current hand before the flag applies', () => {
    let s = startedHand({ playerCount: 3 })
    s = mustOk(sitOut(s, 0), 'sit out').snapshot
    // Seat 0 can still act: fold, call, raise are all legal.
    s = played(s, 0, { kind: 'call' })
    expect(s.players.find((p) => p.seatIndex === 0)!.handStatus).toBe('waiting')
  })
})
