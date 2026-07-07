import { Schema } from 'effect'

import { GameSnapshot } from '../../shared/schema/snapshot'
import type { AppDatabase } from './db'
import { updateGameStatus } from './game-store'

const encodeSnapshot = Schema.encodeSync(GameSnapshot)
const decodeSnapshot = Schema.decodeUnknownSync(GameSnapshot)

export interface SettlementSummary {
  totalBuyInCents: number
  transfers: {
    fromProfileId: string
    toProfileId: string
    cents: number
  }[]
}

export interface FinishedGameRow {
  gameId: string
  finishedAt: number
  finalSnapshot: GameSnapshot
  settlement: SettlementSummary
}

/**
 * Archive a finished game: final snapshot plus settlement summary stay
 * queryable for history and stats; finished games are never auto-deleted
 * (SPEC.md Persistence And History). Events are retained as well — the
 * SPEC minimum is a subset, and keeping the full log is the simpler
 * superset for MVP.
 */
export function archiveFinishedGame(
  db: AppDatabase,
  options: {
    gameId: string
    finishedAt: number
    finalSnapshot: GameSnapshot
    settlement: SettlementSummary
  },
): void {
  const run = db.transaction(() => {
    updateGameStatus(db, options.gameId, 'finished', options.finishedAt)
    db.prepare(
      `INSERT INTO finished_games (game_id, finished_at, final_snapshot, settlement)
       VALUES (?, ?, ?, ?)`,
    ).run(
      options.gameId,
      options.finishedAt,
      JSON.stringify(encodeSnapshot(options.finalSnapshot)),
      JSON.stringify(options.settlement),
    )
  })
  run()
}

export function getFinishedGame(
  db: AppDatabase,
  gameId: string,
): FinishedGameRow | null {
  const row = db
    .prepare('SELECT * FROM finished_games WHERE game_id = ?')
    .get(gameId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    gameId: row.game_id as string,
    finishedAt: row.finished_at as number,
    finalSnapshot: decodeSnapshot(JSON.parse(row.final_snapshot as string)),
    settlement: JSON.parse(row.settlement as string) as SettlementSummary,
  }
}

export function listFinishedGames(
  db: AppDatabase,
): { gameId: string; finishedAt: number }[] {
  const rows = db
    .prepare('SELECT game_id, finished_at FROM finished_games ORDER BY finished_at')
    .all() as Record<string, unknown>[]
  return rows.map((row) => ({
    gameId: row.game_id as string,
    finishedAt: row.finished_at as number,
  }))
}

/** Full archive rows for history and stats, newest first. */
export function listFinishedGameRows(db: AppDatabase): FinishedGameRow[] {
  const rows = db
    .prepare('SELECT * FROM finished_games ORDER BY finished_at DESC, game_id DESC')
    .all() as Record<string, unknown>[]
  return rows.map((row) => ({
    gameId: row.game_id as string,
    finishedAt: row.finished_at as number,
    finalSnapshot: decodeSnapshot(JSON.parse(row.final_snapshot as string)),
    settlement: JSON.parse(row.settlement as string) as SettlementSummary,
  }))
}

export interface CashSettlementRow {
  gameId: string
  finalizedAt: number
  transfers: {
    fromProfileId: string
    toProfileId: string
    cents: number
  }[]
}

/** The finalized (possibly user-edited) payment transfers, when recorded. */
export function getCashSettlement(
  db: AppDatabase,
  gameId: string,
): CashSettlementRow | null {
  const row = db
    .prepare('SELECT * FROM cash_settlements WHERE game_id = ?')
    .get(gameId) as Record<string, unknown> | undefined
  if (!row) return null
  const payload = JSON.parse(row.payload as string) as {
    transfers: CashSettlementRow['transfers']
  }
  return {
    gameId: row.game_id as string,
    finalizedAt: row.finalized_at as number,
    transfers: payload.transfers,
  }
}
