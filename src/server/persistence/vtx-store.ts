import { Schema } from 'effect'

import { EventEnvelope, type GameEvent } from '../../shared/schema/events'
import { GameSnapshot } from '../../shared/schema/snapshot'
import type { AppDatabase } from './db'

const decodeEnvelope = Schema.decodeUnknownSync(EventEnvelope)
const decodeSnapshot = Schema.decodeUnknownSync(GameSnapshot)

// Read side of the visible-transaction log (SPEC.md Undo): the latest
// transaction plus the snapshot history around it. Undo restores the stored
// before-snapshot directly — never an event replay.

export interface LatestTransactionRow {
  transactionId: string
  seq: number
  label: string
}

export function latestTransactionRow(
  db: AppDatabase,
  gameId: string,
): LatestTransactionRow | null {
  const row = db
    .prepare(
      `SELECT transaction_id, seq, label FROM visible_transactions
       WHERE game_id = ? ORDER BY seq DESC LIMIT 1`,
    )
    .get(gameId) as
    | { transaction_id: string; seq: number; label: string }
    | undefined
  if (!row) return null
  return { transactionId: row.transaction_id, seq: row.seq, label: row.label }
}

/** Events bundled into one visible transaction, in append order. */
export function transactionEvents(
  db: AppDatabase,
  transactionId: string,
): GameEvent[] {
  const rows = db
    .prepare(
      'SELECT payload FROM events WHERE visible_transaction_id = ? ORDER BY seq',
    )
    .all(transactionId) as { payload: string }[]
  return rows.map((row) => decodeEnvelope(JSON.parse(row.payload)).event)
}

/** The snapshot persisted exactly at `eventSeq` (a transaction's after-state). */
export function snapshotAtSeq(
  db: AppDatabase,
  gameId: string,
  eventSeq: number,
): GameSnapshot | null {
  const row = db
    .prepare(
      'SELECT payload FROM snapshots WHERE game_id = ? AND event_seq = ?',
    )
    .get(gameId, eventSeq) as { payload: string } | undefined
  return row ? decodeSnapshot(JSON.parse(row.payload)) : null
}

/** The newest snapshot strictly before `eventSeq` (a transaction's before-state). */
export function snapshotBeforeSeq(
  db: AppDatabase,
  gameId: string,
  eventSeq: number,
): GameSnapshot | null {
  const row = db
    .prepare(
      `SELECT payload FROM snapshots
       WHERE game_id = ? AND event_seq < ? ORDER BY event_seq DESC LIMIT 1`,
    )
    .get(gameId, eventSeq) as { payload: string } | undefined
  return row ? decodeSnapshot(JSON.parse(row.payload)) : null
}
