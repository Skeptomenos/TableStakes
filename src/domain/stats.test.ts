import { describe, expect, it } from 'vitest'

import { aggregateProfileStats, type FinishedGameRecord } from './stats'
import { makeBetweenHandsSnapshot } from './state/fixtures'
import type { GameSnapshot } from './state/types'

// Session-level stats derived from already-tracked accounting data
// (SPEC.md Stats): per-game nets come from the archived final snapshot via
// the same pool-proportional cash-out math the table saw.

function finishedGame(options: {
  gameId: string
  finishedAt: number
  lastHandNumber: number
  stacks: Record<number, number>
  playerCount?: number
}): FinishedGameRecord {
  const base = makeBetweenHandsSnapshot({
    playerCount: options.playerCount ?? 2,
    playerOverrides: Object.fromEntries(
      Object.entries(options.stacks).map(([seat, stack]) => [seat, { stack }]),
    ),
  })
  const finalSnapshot: GameSnapshot = {
    ...base,
    game: {
      ...base.game,
      status: 'finished',
      lastHandNumber: options.lastHandNumber,
    },
  }
  return {
    gameId: options.gameId,
    finishedAt: options.finishedAt,
    finalSnapshot,
  }
}

// Fixture profiles: seat 0 -> profile_s0, seat 1 -> profile_s1 (1000 cents
// buy-in each by default).

describe('aggregateProfileStats', () => {
  it('aggregates games played, totals, extremes, average, and hands', () => {
    const games = [
      // profile_s0 wins 500 cents over 12 hands.
      finishedGame({
        gameId: 'g1',
        finishedAt: 1,
        lastHandNumber: 12,
        stacks: { 0: 1500, 1: 500 },
      }),
      // profile_s0 loses 300 cents over 8 hands.
      finishedGame({
        gameId: 'g2',
        finishedAt: 2,
        lastHandNumber: 8,
        stacks: { 0: 700, 1: 1300 },
      }),
    ]
    const stats = aggregateProfileStats('profile_s0', games)

    expect(stats.gamesPlayed).toBe(2)
    expect(stats.totalBuyInCents).toBe(2000)
    expect(stats.totalCashOutCents).toBe(2200)
    expect(stats.totalNetCents).toBe(200)
    expect(stats.biggestWinCents).toBe(500)
    expect(stats.biggestLossCents).toBe(-300)
    expect(stats.averageNetCents).toBe(100)
    expect(stats.totalHandsPlayed).toBe(20)

    // Per-game settlement summary, newest first.
    expect(stats.games.map((g) => g.gameId)).toEqual(['g2', 'g1'])
    expect(stats.games[1]).toMatchObject({
      gameId: 'g1',
      handsPlayed: 12,
      buyInCents: 1000,
      cashOutCents: 1500,
      netCents: 500,
    })
  })

  it('skips games the profile did not play', () => {
    const games = [
      finishedGame({
        gameId: 'g1',
        finishedAt: 1,
        lastHandNumber: 3,
        stacks: { 0: 1500, 1: 500 },
      }),
    ]
    const stats = aggregateProfileStats('profile_s9', games)
    expect(stats.gamesPlayed).toBe(0)
    expect(stats.totalNetCents).toBe(0)
    expect(stats.games).toEqual([])
    expect(stats.biggestWinCents).toBe(0)
    expect(stats.biggestLossCents).toBe(0)
    expect(stats.averageNetCents).toBe(0)
  })

  it('a profile that never wins reports zero biggest win, not a loss', () => {
    const games = [
      finishedGame({
        gameId: 'g1',
        finishedAt: 1,
        lastHandNumber: 5,
        stacks: { 0: 400, 1: 1600 },
      }),
    ]
    const stats = aggregateProfileStats('profile_s0', games)
    expect(stats.biggestWinCents).toBe(0)
    expect(stats.biggestLossCents).toBe(-600)
    expect(stats.totalNetCents).toBe(-600)
  })
})
