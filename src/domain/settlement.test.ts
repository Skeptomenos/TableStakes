import { describe, expect, it } from 'vitest'

import { totalChipsInPlay } from './invariants'
import { startHand, confirmNextStreet } from './reducers/hand-reducer'
import {
  awardPot,
  remainingUnallocated,
  splitPot,
  takeAllEligiblePots,
} from './settlement'
import { mustOk, played, runOutToShowdown, startedHand } from './testing'
import type { GameSnapshot } from './state/types'

// Showdown with two pots: main (600, all three eligible) and side pot 1
// (1000, seats 0 and 2 eligible). Seat 1 is all-in for 200.
function twoPotShowdown(): GameSnapshot {
  let s = startedHand({ playerCount: 3, stacks: { 1: 200 } })
  s = played(s, 0, { kind: 'raise', amount: 400 })
  s = played(s, 1, { kind: 'all-in' })
  s = played(s, 2, { kind: 'call' })
  s = mustOk(confirmNextStreet(s), 'to flop').snapshot
  s = played(s, 2, { kind: 'bet', amount: 300 })
  s = played(s, 0, { kind: 'call' })
  return runOutToShowdown(s)
}

function playerId(s: GameSnapshot, seatIndex: number): string {
  return s.players.find((p) => p.seatIndex === seatIndex)!.id
}

describe('settlement order', () => {
  it('only settles the first unresolved pot', () => {
    const s = twoPotShowdown()
    const sidePotId = s.pots[1]!.id
    const result = awardPot(s, sidePotId, playerId(s, 0))
    expect(result.ok).toBe(false)
  })

  it('settles main pot then side pot in display order', () => {
    let s = twoPotShowdown()
    const total = totalChipsInPlay(s)

    s = mustOk(awardPot(s, s.pots[0]!.id, playerId(s, 1)), 'main').snapshot
    expect(s.pots).toHaveLength(1)
    expect(s.pots[0]?.label).toBe('Side Pot 1')

    const settled = mustOk(awardPot(s, s.pots[0]!.id, playerId(s, 0)), 'side')
    expect(settled.events.map((e) => e._tag)).toContain('hand-settled')
    s = settled.snapshot
    expect(s.game.status).toBe('between-hands')
    expect(s.hand).toBeNull()
    expect(totalChipsInPlay(s)).toBe(total)
  })
})

describe('award eligibility', () => {
  it('rejects awarding a pot to an ineligible player', () => {
    const s = twoPotShowdown()
    // Seat 1 (all-in for 200) is not eligible for the side pot; settle the
    // main pot first, then try to give seat 1 the side pot.
    const afterMain = mustOk(
      awardPot(s, s.pots[0]!.id, playerId(s, 1)),
      'main',
    ).snapshot
    const result = awardPot(afterMain, afterMain.pots[0]!.id, playerId(s, 1))
    expect(result.ok).toBe(false)
  })

  it('credits the winner stack with the pot amount', () => {
    const s = twoPotShowdown()
    const before = s.players.find((p) => p.seatIndex === 1)!.stack
    const after = mustOk(awardPot(s, s.pots[0]!.id, playerId(s, 1)), 'main')
      .snapshot
    expect(after.players.find((p) => p.seatIndex === 1)!.stack).toBe(
      before + 600,
    )
  })
})

describe('split pots', () => {
  it('requires exact allocation of the whole pot', () => {
    const s = twoPotShowdown()
    const potId = s.pots[0]!.id
    const short = splitPot(s, potId, [
      { playerId: playerId(s, 0), chips: 300 },
      { playerId: playerId(s, 1), chips: 200 },
    ])
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.error._tag).toBe('PotAllocationMismatch')

    const over = splitPot(s, potId, [
      { playerId: playerId(s, 0), chips: 400 },
      { playerId: playerId(s, 1), chips: 300 },
    ])
    expect(over.ok).toBe(false)
  })

  it('reports remaining unallocated chips for the split UI', () => {
    const s = twoPotShowdown()
    const pot = s.pots[0]!
    expect(
      remainingUnallocated(pot, [{ playerId: playerId(s, 0), chips: 250 }]),
    ).toBe(350)
    expect(
      remainingUnallocated(pot, [
        { playerId: playerId(s, 0), chips: 300 },
        { playerId: playerId(s, 1), chips: 300 },
      ]),
    ).toBe(0)
  })

  it('splits exactly among eligible winners', () => {
    let s = twoPotShowdown()
    const total = totalChipsInPlay(s)
    const result = mustOk(
      splitPot(s, s.pots[0]!.id, [
        { playerId: playerId(s, 0), chips: 300 },
        { playerId: playerId(s, 1), chips: 300 },
      ]),
      'split main',
    )
    s = result.snapshot
    expect(result.events.map((e) => e._tag)).toContain('pot-split')
    expect(s.pots).toHaveLength(1)
    expect(totalChipsInPlay(s)).toBe(total)
  })

  it('rejects allocations to players not eligible for the pot', () => {
    const s = twoPotShowdown()
    const afterMain = mustOk(
      awardPot(s, s.pots[0]!.id, playerId(s, 1)),
      'main',
    ).snapshot
    // Side pot: seat 1 not eligible.
    const result = splitPot(afterMain, afterMain.pots[0]!.id, [
      { playerId: playerId(s, 1), chips: 500 },
      { playerId: playerId(s, 0), chips: 500 },
    ])
    expect(result.ok).toBe(false)
  })
})

describe('take all eligible pots', () => {
  it('is rejected when the winner is not eligible for every unresolved pot', () => {
    const s = twoPotShowdown()
    const result = takeAllEligiblePots(s, playerId(s, 1))
    expect(result.ok).toBe(false)
  })

  it('settles every pot in display order as one bundle', () => {
    const s = twoPotShowdown()
    const total = totalChipsInPlay(s)
    const result = mustOk(takeAllEligiblePots(s, playerId(s, 0)), 'take all')

    const tags = result.events.map((e) => e._tag)
    expect(tags.filter((t) => t === 'pot-awarded')).toHaveLength(2)
    expect(tags).toContain('hand-settled')

    const next = result.snapshot
    expect(next.pots).toHaveLength(0)
    expect(next.game.status).toBe('between-hands')
    expect(totalChipsInPlay(next)).toBe(total)
    // Winner receives both pots: 1000 - 700 committed + 1600 won.
    expect(next.players.find((p) => p.seatIndex === 0)!.stack).toBe(1900)
  })
})

describe('hand close after settlement', () => {
  it('advances the dealer, marks zero-chip players needs-rebuy, and blocks Next hand until settled', () => {
    const s = twoPotShowdown()

    // Next hand is blocked while pots are unresolved.
    expect(startHand(s, 'hand_2').ok).toBe(false)

    const done = mustOk(takeAllEligiblePots(s, playerId(s, 0)), 'take all')
      .snapshot
    // Seat 1 went all-in for 200 and lost everything.
    expect(done.players.find((p) => p.seatIndex === 1)!.handStatus).toBe(
      'needs-rebuy',
    )
    expect(done.game.dealerSeat).toBe(2)
    expect(done.game.lastHandNumber).toBe(1)
    expect(startHand(done, 'hand_2').ok).toBe(true)
  })
})
