import { computeCashOut } from './cash-out'
import type { GameSnapshot } from './state/types'

// Session-level profile stats (SPEC.md Stats): derived entirely from the
// archived final snapshots via the same pool-proportional cash-out math the
// table saw — no extra in-hand tracking, no strategy analytics. Multiple
// seats held by one profile in a game aggregate into one position.

export interface FinishedGameRecord {
  gameId: string
  finishedAt: number
  finalSnapshot: GameSnapshot
}

export interface GameStatEntry {
  gameId: string
  code: string
  finishedAt: number
  handsPlayed: number
  buyInCents: number
  cashOutCents: number
  netCents: number
}

export interface ProfileStats {
  profileId: string
  gamesPlayed: number
  totalBuyInCents: number
  totalCashOutCents: number
  totalNetCents: number
  /** Best single-game net; 0 when the profile never finished a game up. */
  biggestWinCents: number
  /** Worst single-game net (negative); 0 when the profile never lost. */
  biggestLossCents: number
  /** Truncated toward zero; 0 when no games were played. */
  averageNetCents: number
  totalHandsPlayed: number
  /** Per-game settlement summary, newest first. */
  games: GameStatEntry[]
}

export function aggregateProfileStats(
  profileId: string,
  games: readonly FinishedGameRecord[],
): ProfileStats {
  const entries: GameStatEntry[] = []
  for (const game of games) {
    const summary = computeCashOut(game.finalSnapshot)
    const mine = summary.players.filter((p) => p.profileId === profileId)
    if (mine.length === 0) continue
    entries.push({
      gameId: game.gameId,
      code: game.finalSnapshot.game.code,
      finishedAt: game.finishedAt,
      handsPlayed: game.finalSnapshot.game.lastHandNumber,
      buyInCents: mine.reduce((sum, p) => sum + p.buyInCents, 0),
      cashOutCents: mine.reduce((sum, p) => sum + p.cashOutCents, 0),
      netCents: mine.reduce((sum, p) => sum + p.netCents, 0),
    })
  }
  entries.sort((a, b) => b.finishedAt - a.finishedAt)

  const totalNetCents = entries.reduce((sum, e) => sum + e.netCents, 0)
  return {
    profileId,
    gamesPlayed: entries.length,
    totalBuyInCents: entries.reduce((sum, e) => sum + e.buyInCents, 0),
    totalCashOutCents: entries.reduce((sum, e) => sum + e.cashOutCents, 0),
    totalNetCents,
    biggestWinCents: Math.max(0, ...entries.map((e) => e.netCents)),
    biggestLossCents: Math.min(0, ...entries.map((e) => e.netCents)),
    averageNetCents:
      entries.length === 0 ? 0 : Math.trunc(totalNetCents / entries.length),
    totalHandsPlayed: entries.reduce((sum, e) => sum + e.handsPlayed, 0),
    games: entries,
  }
}
