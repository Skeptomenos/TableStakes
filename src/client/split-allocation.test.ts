import { describe, expect, it } from 'vitest'

import { adjust, evenSplit, type SplitSeat } from './split-allocation'

// ADR 0003 Decision 1 / DESIGN.md Hand Settlement: chop selection allocates
// the pot evenly at once, with the integer remainder going one chip at a
// time to the selected players in seat order starting from the earliest
// seat after the dealer button. Adjustments stay zero-sum.

function seats(ids: string[]): SplitSeat[] {
  return ids.map((playerId, seatIndex) => ({ playerId, seatIndex }))
}

describe('evenSplit', () => {
  it('splits evenly with no remainder', () => {
    const result = evenSplit(1300, seats(['a', 'b']), 0)
    expect(result).toEqual({ a: 650, b: 650 })
  })

  it('gives the odd chip to the earliest seat after the dealer (dealer 0)', () => {
    const result = evenSplit(1300, seats(['a', 'b', 'c']), 0)
    // seats: a=0, b=1, c=2; dealer=0 -> earliest seat after dealer is 1 (b).
    expect(result).toEqual({ a: 433, b: 434, c: 433 })
  })

  it('gives the odd chip to the earliest seat after the dealer (dealer 1)', () => {
    const result = evenSplit(1300, seats(['a', 'b', 'c']), 1)
    // earliest seat after dealer 1 is seat 2 (c).
    expect(result).toEqual({ a: 433, b: 433, c: 434 })
  })

  it('wraps to the earliest seat overall when the dealer is the last seat', () => {
    const result = evenSplit(1300, seats(['a', 'b', 'c']), 2)
    // No selected seat is after dealer 2; wraps to the earliest seat, 0 (a).
    expect(result).toEqual({ a: 434, b: 433, c: 433 })
  })

  it('distributes a multi-chip remainder one at a time, wrapping the selection', () => {
    const result = evenSplit(1001, seats(['a', 'b', 'c']), 0)
    // base 333, remainder 2: b (seat 1) then c (seat 2).
    expect(result).toEqual({ a: 333, b: 334, c: 334 })
  })

  it('sums to the pot amount regardless of player count or remainder', () => {
    for (const [amount, count] of [[1300, 2], [1300, 3], [1001, 3], [999, 4]] as const) {
      const ids = Array.from({ length: count }, (_, i) => `p${i}`)
      const result = evenSplit(amount, seats(ids), 0)
      const sum = Object.values(result).reduce((a, b) => a + b, 0)
      expect(sum).toBe(amount)
    }
  })
})

describe('adjust', () => {
  it('increases the target by one step, pulling from the largest other share', () => {
    const result = adjust({ a: 500, b: 800 }, 'a', 1, 50)
    expect(result).toEqual({ a: 550, b: 750 })
  })

  it('decreases the target by one step, pushing the freed chips to the largest other share', () => {
    const result = adjust({ a: 500, b: 800 }, 'a', -1, 50)
    expect(result).toEqual({ a: 450, b: 850 })
  })

  it('never breaks the total sum', () => {
    const before = { a: 500, b: 300, c: 200 }
    const total = Object.values(before).reduce((x, y) => x + y, 0)
    const after = adjust(before, 'c', 1, 50)
    const afterTotal = Object.values(after).reduce((x, y) => x + y, 0)
    expect(afterTotal).toBe(total)
  })

  it('pulls from whichever OTHER share is currently largest', () => {
    // b (800) is larger than c (100): increasing a must pull from b.
    const result = adjust({ a: 100, b: 800, c: 100 }, 'a', 1, 50)
    expect(result).toEqual({ a: 150, b: 750, c: 100 })
  })

  it('floors the donor at 0 instead of moving a full step past it', () => {
    const result = adjust({ a: 500, b: 20 }, 'a', 1, 50)
    expect(result).toEqual({ a: 520, b: 0 })
  })

  it('no-ops increasing the target when every other share is already 0', () => {
    const before = { a: 500, b: 0 }
    const result = adjust(before, 'a', 1, 50)
    expect(result).toEqual(before)
  })

  it('no-ops decreasing the target when the target itself is already 0', () => {
    const before = { a: 0, b: 500 }
    const result = adjust(before, 'a', -1, 50)
    expect(result).toEqual(before)
  })

  it('decreasing works even when every OTHER share is 0 (FINAL-verification finding)', () => {
    // Dead-end regression: after pulling the whole pot onto one player
    // with +, pressing − must give chips back — a zero-chip receiver is
    // fine; only DONORS need chips. Pre-fix this no-opped and the stepper
    // flow was stuck at {a: pot, b: 0}.
    const result = adjust({ a: 500, b: 0 }, 'a', -1, 50)
    expect(result).toEqual({ a: 450, b: 50 })
  })
})
