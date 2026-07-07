import { describe, expect, it } from 'vitest'

import { totalChipsInPlay } from './invariants'
import { startHand } from './reducers/hand-reducer'
import { claimSeat } from './seats'
import { makeBetweenHandsSnapshot } from './state/fixtures'

function expectOk<T extends { ok: boolean }>(result: T) {
  expect(result.ok, JSON.stringify(result)).toBe(true)
  return result as Extract<T, { ok: true }>
}

describe('startHand: dealer, blinds, first actor', () => {
  it('posts blinds and selects the first actor for 3 players', () => {
    const snapshot = makeBetweenHandsSnapshot({ playerCount: 3, dealerSeat: 0 })
    const { snapshot: next, events } = expectOk(startHand(snapshot, 'hand_1'))

    expect(next.game.status).toBe('in-hand')
    expect(next.hand?.handNumber).toBe(1)
    expect(next.hand?.dealerSeat).toBe(0)
    expect(next.hand?.smallBlindSeat).toBe(1)
    expect(next.hand?.bigBlindSeat).toBe(2)
    expect(next.hand?.street).toBe('pre-flop')
    // First actor pre-flop is the seat after the big blind.
    expect(next.hand?.activeSeat).toBe(0)
    expect(next.hand?.currentBet).toBe(100)

    const sb = next.players.find((p) => p.seatIndex === 1)
    const bb = next.players.find((p) => p.seatIndex === 2)
    expect(sb?.stack).toBe(950)
    expect(bb?.stack).toBe(900)

    const tags = events.map((e) => e._tag)
    expect(tags).toContain('hand-started')
    expect(tags.filter((t) => t === 'blind-posted')).toHaveLength(2)

    expect(totalChipsInPlay(next)).toBe(totalChipsInPlay(snapshot))
  })

  it('heads-up: dealer posts the small blind and acts first pre-flop', () => {
    const snapshot = makeBetweenHandsSnapshot({ playerCount: 2, dealerSeat: 0 })
    const { snapshot: next } = expectOk(startHand(snapshot, 'hand_1'))

    expect(next.hand?.smallBlindSeat).toBe(0)
    expect(next.hand?.bigBlindSeat).toBe(1)
    expect(next.hand?.activeSeat).toBe(0)
  })

  it('skips a busted dealer seat to the next active player (dead button)', () => {
    const snapshot = makeBetweenHandsSnapshot({
      playerCount: 3,
      dealerSeat: 0,
      playerOverrides: {
        0: { stack: 0, handStatus: 'needs-rebuy' },
      },
    })
    const { snapshot: next } = expectOk(startHand(snapshot, 'hand_1'))

    // Two players remain dealt in, so heads-up ordering applies: the
    // (skipped-to) dealer posts the small blind.
    expect(next.hand?.dealerSeat).toBe(1)
    expect(next.hand?.smallBlindSeat).toBe(1)
    expect(next.hand?.bigBlindSeat).toBe(2)
  })

  it('deals around sitting-out players without posting their blinds', () => {
    const snapshot = makeBetweenHandsSnapshot({
      playerCount: 3,
      dealerSeat: 0,
      playerOverrides: {
        1: { sitOutNextHand: true, handStatus: 'sitting-out' },
      },
    })
    const { snapshot: next } = expectOk(startHand(snapshot, 'hand_1'))

    // Only seats 0 and 2 are dealt in -> heads-up ordering applies.
    expect(next.hand?.smallBlindSeat).toBe(0)
    expect(next.hand?.bigBlindSeat).toBe(2)
    const sitter = next.players.find((p) => p.seatIndex === 1)
    expect(sitter?.handStatus).toBe('sitting-out')
    expect(
      next.hand?.commitments.find((c) => c.seatIndex === 1),
    ).toBeUndefined()
  })

  it('does not deal in a released seat even when chips remain', () => {
    // Departed-player flow (Slice 12, from the Slice 10 dogfood): releasing
    // a seat is the one audited action that stops dealing the departed
    // player in. Chips stay on the table and in the cash-out.
    const snapshot = makeBetweenHandsSnapshot({
      playerCount: 3,
      dealerSeat: 2,
      playerOverrides: {
        1: { connection: 'released' },
      },
    })
    const { snapshot: next } = expectOk(startHand(snapshot, 'hand_1'))

    expect(next.hand?.commitments.find((c) => c.seatIndex === 1)).toBeUndefined()
    expect([
      next.hand?.dealerSeat,
      next.hand?.smallBlindSeat,
      next.hand?.bigBlindSeat,
    ]).not.toContain(1)
    const released = next.players.find((p) => p.seatIndex === 1)
    expect(released?.stack).toBe(1000)
    expect(totalChipsInPlay(next)).toBe(totalChipsInPlay(snapshot))
  })

  it('deals a released seat back in after its profile reclaims it', () => {
    const base = makeBetweenHandsSnapshot({
      playerCount: 3,
      dealerSeat: 0,
      playerOverrides: {
        1: { connection: 'released' },
      },
    })
    const reclaimed = expectOk(
      claimSeat(base, 1, 'profile_s1', {}),
    ).snapshot
    const { snapshot: next } = expectOk(startHand(reclaimed, 'hand_1'))
    expect(next.hand?.commitments.map((c) => c.seatIndex)).toContain(1)
  })

  it('returns a sitting-out player with no missed-blind penalty', () => {
    const snapshot = makeBetweenHandsSnapshot({
      playerCount: 3,
      dealerSeat: 0,
      playerOverrides: {
        1: { handStatus: 'sitting-out', sitOutNextHand: false },
      },
    })
    const { snapshot: next } = expectOk(startHand(snapshot, 'hand_1'))

    const returned = next.players.find((p) => p.seatIndex === 1)
    // Dealt back in as the small blind: pays exactly the small blind, no penalty.
    expect(returned?.handStatus).not.toBe('sitting-out')
    expect(returned?.stack).toBe(950)
  })

  it('posts a short-stacked big blind all-in for less at nominal current bet', () => {
    const snapshot = makeBetweenHandsSnapshot({
      playerCount: 3,
      dealerSeat: 0,
      playerOverrides: { 2: { stack: 60 } },
    })
    const before = totalChipsInPlay(snapshot)
    const { snapshot: next } = expectOk(startHand(snapshot, 'hand_1'))

    const bb = next.players.find((p) => p.seatIndex === 2)
    expect(bb?.stack).toBe(0)
    expect(bb?.handStatus).toBe('all-in')
    expect(
      next.hand?.commitments.find((c) => c.seatIndex === 2)?.total,
    ).toBe(60)
    // The amount to match stays the nominal big blind; side pots absorb the
    // shortfall (SPEC.md Blinds).
    expect(next.hand?.currentBet).toBe(100)
    expect(totalChipsInPlay(next)).toBe(before)
  })

  it('refuses to start a hand with fewer than 2 players holding chips', () => {
    const snapshot = makeBetweenHandsSnapshot({
      playerCount: 2,
      dealerSeat: 0,
      playerOverrides: { 1: { stack: 0, handStatus: 'needs-rebuy' } },
    })
    const result = startHand(snapshot, 'hand_1')
    expect(result.ok).toBe(false)
  })
})
