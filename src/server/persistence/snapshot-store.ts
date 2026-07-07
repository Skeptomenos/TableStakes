import { Schema } from 'effect'

import { GameSnapshot } from '../../shared/schema/snapshot'
import type { AppDatabase } from './db'

const encodeSnapshot = Schema.encodeSync(GameSnapshot)
const decodeSnapshot = Schema.decodeUnknownSync(GameSnapshot)

export interface StoredSnapshot {
  eventSeq: number
  snapshot: GameSnapshot
}

/**
 * Snapshots are a restore optimization, never the source of truth
 * (ARCHITECTURE.md): restart = latest snapshot + later events, or full
 * event replay when no snapshot exists.
 */
export function saveSnapshot(
  db: AppDatabase,
  gameId: string,
  eventSeq: number,
  snapshot: GameSnapshot,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO snapshots (game_id, event_seq, payload)
     VALUES (?, ?, ?)`,
  ).run(gameId, eventSeq, JSON.stringify(encodeSnapshot(snapshot)))
}

/** Latest snapshot for a game; validated on read (trust boundary). */
export function latestSnapshot(
  db: AppDatabase,
  gameId: string,
): StoredSnapshot | null {
  const row = db
    .prepare(
      `SELECT event_seq, payload FROM snapshots
       WHERE game_id = ? ORDER BY event_seq DESC LIMIT 1`,
    )
    .get(gameId) as { event_seq: number; payload: string } | undefined
  if (!row) return null
  return {
    eventSeq: row.event_seq,
    snapshot: decodeSnapshot(JSON.parse(row.payload)),
  }
}
