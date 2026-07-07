import { describe, expect, it } from 'vitest'

import { recordBuyIn } from './buy-ins'
import { computeCashOut, finalizeCashOut, finishGame, minimizeTransfers } from './cash-out'
import { totalChipsInPlay } from './invariants'
import { recordRebuy } from './rebuy'
import { makeBetweenHandsSnapshot, makeSetupSnapshot, makeTestSettings } from './state/fixtures'
import { mustOk, played, runOutToShowdown, startedHand } from './testing'
import { takeAllEligiblePots } from './settlement'
import type { GameSnapshot } from './state/types'

function playerId(s: GameSnapshot, seatIndex: number): string {
  return s.players.find((p) => p.seatIndex === seatIndex)!.id
}

describe('buy-ins', () => {
  it('records the SPEC example economy: 10 EUR = 1000 chips', () => {
    const s = makeSetupSnapshot({ playerCount: 2 })
    const result = mustOk(
      recordBuyIn(s, playerId(s, 0), { currency: 'EUR', cents: 1000 }, 1000),
      'buy-in',
    )
    const player = result.snapshot.players.find((p) => p.seatIndex === 0)!
    expect(player.totalBuyInCents).toBe(2000) // fixture starts at 1000
    expect(player.totalChipsPurchased).toBe(2000)
    expect(player.stack).toBe(2000)
    expect(result.events.map((e) => e._tag)).toContain('buy-in-recorded')
  })

  it('rejects buy-ins in a different currency than the game', () => {
    const s = makeSetupSnapshot({ playerCount: 2 })
    const result = recordBuyIn(
      s,
      playerId(s, 0),
      { currency: 'USD', cents: 1000 },
      1000,
    )
    expect(result.ok).toBe(false)
  })
})

describe('rebuys', () => {
  it('applies a between-hands rebuy to the stack immediately and clears needs-rebuy', () => {
    const s = makeBetweenHandsSnapshot({
      playerCount: 3,
      playerOverrides: { 1: { stack: 0, handStatus: 'needs-rebuy' } },
    })
    const result = mustOk(
      recordRebuy(s, playerId(s, 1), { currency: 'EUR', cents: 500 }, 500),
      'rebuy',
    )
    const player = result.snapshot.players.find((p) => p.seatIndex === 1)!
    expect(player.stack).toBe(500)
    expect(player.handStatus).toBe('waiting')
    expect(player.totalBuyInCents).toBe(1500)
    expect(player.totalChipsPurchased).toBe(1500)
    expect(result.events.map((e) => e._tag)).toContain('rebuy-recorded')
  })

  it('defers an active-hand rebuy for a folded player to the next hand', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    const before = totalChipsInPlay(s)

    const result = mustOk(
      recordRebuy(s, playerId(s, 0), { currency: 'EUR', cents: 500 }, 500),
      'deferred rebuy',
    )
    s = result.snapshot
    const player = s.players.find((p) => p.seatIndex === 0)!
    // Stack unchanged mid-hand; chips wait as pending so current-hand side
    // pots and eligibility cannot change.
    expect(player.stack).toBe(1000)
    expect(player.pendingRebuyChips).toBe(500)
    expect(totalChipsInPlay(s)).toBe(before + 500)

    // Pending chips land on the stack when the hand closes.
    s = played(s, 1, { kind: 'call' })
    s = played(s, 2, { kind: 'check' })
    s = runOutToShowdown(s)
    s = mustOk(takeAllEligiblePots(s, playerId(s, 1)), 'settle').snapshot
    const closed = s.players.find((p) => p.seatIndex === 0)!
    expect(closed.stack).toBe(1500)
    expect(closed.pendingRebuyChips).toBe(0)
  })

  it('rejects active-hand rebuys from players still contesting the hand', () => {
    const s = startedHand({ playerCount: 3 })
    const result = recordRebuy(
      s,
      playerId(s, 0),
      { currency: 'EUR', cents: 500 },
      500,
    )
    expect(result.ok).toBe(false)
  })
})

describe('cash-out math', () => {
  it('converts chips back to cents so total cash-out equals total buy-ins', () => {
    // Two players, 1000 cents each; seat 0 wins 500 chips from seat 1.
    const s = makeBetweenHandsSnapshot({
      playerCount: 2,
      playerOverrides: { 0: { stack: 1500 }, 1: { stack: 500 } },
    })
    const summary = computeCashOut(s)
    expect(summary.totalBuyInCents).toBe(2000)
    expect(summary.totalCashOutCents).toBe(2000)
    const [p0, p1] = summary.players
    expect(p0?.cashOutCents).toBe(1500)
    expect(p0?.netCents).toBe(500)
    expect(p1?.cashOutCents).toBe(500)
    expect(p1?.netCents).toBe(-500)
  })

  it('allocates an explicit rounding remainder', () => {
    // 300 chips per 1000 cents makes thirds: stacks 301/299 cannot split
    // 2000 cents evenly.
    const s = makeBetweenHandsSnapshot({
      playerCount: 2,
      settings: makeTestSettings({ defaultStack: 300 }),
      playerOverrides: {
        0: { stack: 301, totalChipsPurchased: 300 },
        1: { stack: 299, totalChipsPurchased: 300 },
      },
    })
    const summary = computeCashOut(s)
    expect(summary.roundingRemainderCents).toBeGreaterThan(0)
    expect(summary.totalCashOutCents).toBe(summary.totalBuyInCents)
    expect(
      summary.players.reduce((sum, p) => sum + p.cashOutCents, 0),
    ).toBe(2000)
  })

  it('refunds buy-ins when no chips remain in play (verification F2)', () => {
    // Unreachable under chip conservation, but the guard must hold: with a
    // positive buy-in pool and zero total chips, proportional shares are
    // undefined — everyone gets their buy-in back and nothing is owed.
    const s = makeBetweenHandsSnapshot({
      playerCount: 3,
      playerOverrides: {
        0: { stack: 0, handStatus: 'needs-rebuy' },
        1: { stack: 0, handStatus: 'needs-rebuy' },
        2: { stack: 0, handStatus: 'needs-rebuy' },
      },
    })
    const summary = computeCashOut(s)
    expect(summary.totalCashOutCents).toBe(summary.totalBuyInCents)
    expect(summary.roundingRemainderCents).toBe(0)
    expect(summary.suggestedTransfers).toEqual([])
    for (const player of summary.players) {
      expect(player.cashOutCents).toBe(player.buyInCents)
      expect(player.netCents).toBe(0)
    }
  })

  it('suggests minimized transfers from net losers to net winners', () => {
    const transfers = minimizeTransfers([
      { profileId: 'profile_a', netCents: 500 },
      { profileId: 'profile_b', netCents: -300 },
      { profileId: 'profile_c', netCents: -200 },
    ])
    expect(transfers).toHaveLength(2)
    expect(transfers.reduce((sum, t) => sum + t.cents, 0)).toBe(500)
    for (const t of transfers) {
      expect(t.toProfileId).toBe('profile_a')
    }
  })
})

describe('finish game and cash-out finalization', () => {
  it('finishes only between hands and records the finalized settlement', () => {
    const inHand = startedHand({ playerCount: 3 })
    expect(finishGame(inHand).ok).toBe(false)

    const s = makeBetweenHandsSnapshot({ playerCount: 2 })
    const finished = mustOk(finishGame(s), 'finish')
    expect(finished.snapshot.game.status).toBe('finished')
    expect(finished.events.map((e) => e._tag)).toContain('game-finished')

    const summary = computeCashOut(finished.snapshot)
    const finalized = mustOk(
      finalizeCashOut(finished.snapshot, summary.suggestedTransfers),
      'finalize',
    )
    expect(finalized.events.map((e) => e._tag)).toContain('cash-out-finalized')
  })

  it('rejects finishing a game nobody ever sat down in', () => {
    // Slice 12 decision: an empty setup game has no cash-out meaning and
    // would archive an empty history row.
    const empty = makeSetupSnapshot({ playerCount: 0 })
    const result = finishGame(empty)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toMatch(/seated/i)
    }
  })
})
