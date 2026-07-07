import { Schema } from 'effect'

import { EventEnvelope } from '../../shared/schema/events'
import type { AppDatabase } from './db'

const encodeEnvelope = Schema.encodeSync(EventEnvelope)
const decodeEnvelope = Schema.decodeUnknownSync(EventEnvelope)

export interface StoredEvent {
  seq: number
  envelope: EventEnvelope
}

/**
 * Append accepted events atomically. The append-only log is the source of
 * truth; the server must persist here BEFORE broadcasting or acknowledging
 * (ARCHITECTURE.md persistence rules). Any conflict rolls back the batch.
 */
export function appendEvents(
  db: AppDatabase,
  envelopes: readonly EventEnvelope[],
): number {
  const insert = db.prepare(
    `INSERT INTO events
       (event_id, game_id, hand_id, visible_transaction_id, actor_profile_id, timestamp, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const run = db.transaction(() => {
    let lastSeq = 0
    for (const envelope of envelopes) {
      const info = insert.run(
        envelope.id,
        envelope.gameId,
        envelope.handId,
        envelope.visibleTransactionId,
        envelope.actorProfileId,
        envelope.timestamp,
        JSON.stringify(encodeEnvelope(envelope)),
      )
      lastSeq = Number(info.lastInsertRowid)
    }
    return lastSeq
  })
  return run()
}

/** Events for a game with seq greater than `afterSeq`, in append order. */
export function listEventsAfter(
  db: AppDatabase,
  gameId: string,
  afterSeq: number,
): StoredEvent[] {
  const rows = db
    .prepare(
      'SELECT seq, payload FROM events WHERE game_id = ? AND seq > ? ORDER BY seq',
    )
    .all(gameId, afterSeq) as { seq: number; payload: string }[]
  return rows.map((row) => ({
    seq: row.seq,
    envelope: decodeEnvelope(JSON.parse(row.payload)),
  }))
}
