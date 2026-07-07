import { describe, expect, it } from 'vitest'

import { totalChipsInPlay } from './invariants'
import { confirmNextStreet } from './reducers/hand-reducer'
import { mustOk, played, runOutToShowdown, startedHand } from './testing'

// Default fixture: blinds 50/100, dealer 0, SB seat 1, BB seat 2, actor 0.

describe('pot construction at showdown', () => {
  it('builds a single main pot when nobody is all-in', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'call' })
    s = played(s, 1, { kind: 'call' })
    s = played(s, 2, { kind: 'check' })
    s = runOutToShowdown(s)

    expect(s.pots).toHaveLength(1)
    expect(s.pots[0]?.label).toBe('Main Pot')
    expect(s.pots[0]?.amount).toBe(300)
    expect(s.pots[0]?.eligiblePlayerIds).toHaveLength(3)
    expect(s.hand?.commitments.every((c) => c.total === 0)).toBe(true)
  })

  it('creates one side pot from one all-in with later betting', () => {
    let s = startedHand({ playerCount: 3, stacks: { 1: 200 } })
    const total = totalChipsInPlay(s)

    s = played(s, 0, { kind: 'raise', amount: 400 })
    s = played(s, 1, { kind: 'all-in' }) // 200 total, call for less
    s = played(s, 2, { kind: 'call' })
    // Flop betting continues between seats 0 and 2.
    s = mustOk(confirmNextStreet(s), 'to flop').snapshot
    s = played(s, 2, { kind: 'bet', amount: 300 })
    s = played(s, 0, { kind: 'call' })
    s = runOutToShowdown(s)

    expect(s.pots.map((p) => p.label)).toEqual(['Main Pot', 'Side Pot 1'])
    // Main pot: 200 from each of 3 players. Side pot: (400-200)+300 each
    // from seats 0 and 2.
    expect(s.pots[0]?.amount).toBe(600)
    expect(s.pots[1]?.amount).toBe(1000)
    expect(s.pots[0]?.allInThreshold).toBe(200)
    expect(s.pots[1]?.allInThreshold).toBeNull()

    const short = s.players.find((p) => p.seatIndex === 1)!
    expect(s.pots[0]?.eligiblePlayerIds).toContain(short.id)
    expect(s.pots[1]?.eligiblePlayerIds).not.toContain(short.id)
    expect(totalChipsInPlay(s)).toBe(total)
  })

  it('creates ordered side pots for multiple all-in thresholds and returns uncalled excess', () => {
    let s = startedHand({ playerCount: 3, stacks: { 1: 150, 2: 400 } })
    const total = totalChipsInPlay(s)

    s = played(s, 0, { kind: 'raise', amount: 600 })
    s = played(s, 1, { kind: 'all-in' }) // 150 total
    s = played(s, 2, { kind: 'all-in' }) // 400 total
    s = runOutToShowdown(s)

    // Seat 0 committed 600 but only 400 was callable: 200 returns.
    const raiser = s.players.find((p) => p.seatIndex === 0)!
    expect(raiser.stack).toBe(1000 - 600 + 200)

    expect(s.pots.map((p) => p.label)).toEqual(['Main Pot', 'Side Pot 1'])
    expect(s.pots[0]?.amount).toBe(450) // 150 x 3
    expect(s.pots[1]?.amount).toBe(500) // 250 x 2 (seats 0 and 2)
    expect(s.pots[0]?.eligiblePlayerIds).toHaveLength(3)
    expect(s.pots[1]?.eligiblePlayerIds).toHaveLength(2)
    expect(totalChipsInPlay(s)).toBe(total)
  })

  it('keeps folded contributions in pots without eligibility', () => {
    let s = startedHand({ playerCount: 3, stacks: { 1: 300 } })

    s = played(s, 0, { kind: 'raise', amount: 300 })
    s = played(s, 1, { kind: 'all-in' }) // exactly 300 total
    s = played(s, 2, { kind: 'fold' }) // 100 (big blind) stays in
    s = runOutToShowdown(s)

    expect(s.pots).toHaveLength(1)
    const pot = s.pots[0]!
    expect(pot.amount).toBe(700)

    const folded = s.players.find((p) => p.seatIndex === 2)!
    expect(pot.contributorIds).toContain(folded.id)
    expect(pot.eligiblePlayerIds).not.toContain(folded.id)
    expect(pot.eligiblePlayerIds).toHaveLength(2)
  })

  it('returns uncalled excess when a bet is only called all-in for less', () => {
    let s = startedHand({ playerCount: 2, stacks: { 1: 300 } })
    const total = totalChipsInPlay(s)

    // Heads-up: dealer 0 posts SB, seat 1 posts BB from a 300 stack.
    s = played(s, 0, { kind: 'raise', amount: 500 })
    s = played(s, 1, { kind: 'all-in' }) // 300 total, call for less
    s = runOutToShowdown(s)

    const bettor = s.players.find((p) => p.seatIndex === 0)!
    expect(bettor.stack).toBe(1000 - 500 + 200)
    expect(s.pots).toHaveLength(1)
    expect(s.pots[0]?.amount).toBe(600)
    expect(totalChipsInPlay(s)).toBe(total)
  })

  it('skips betting on run-out streets when fewer than two players can act', () => {
    let s = startedHand({ playerCount: 3, stacks: { 1: 150, 2: 400 } })
    s = played(s, 0, { kind: 'raise', amount: 600 })
    s = played(s, 1, { kind: 'all-in' })
    s = played(s, 2, { kind: 'all-in' })

    // Only seat 0 can act; betting is dead and every street stays ready.
    s = mustOk(confirmNextStreet(s), 'to flop').snapshot
    expect(s.hand?.street).toBe('flop')
    expect(s.hand?.activeSeat).toBeNull()
    expect(s.hand?.nextStreetReady).toBe(true)
  })
})
