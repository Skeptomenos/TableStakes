import { VisibleTransactionId } from '../shared/schema/ids'
import type { ReducerOk } from './result'
import type { GameEvent, GameSnapshot } from './state/types'

/**
 * A visible transaction is one table-visible action bundling the low-level
 * events it caused — the unit undo operates on (SPEC.md Undo). The server
 * captures one per accepted command (Slice 5 persists them).
 */
export interface VisibleTransaction {
  id: VisibleTransactionId
  label: string
  events: GameEvent[]
  before: GameSnapshot
  after: GameSnapshot
}

export function captureTransaction(
  idRaw: string,
  before: GameSnapshot,
  result: ReducerOk,
  label?: string,
): VisibleTransaction {
  return {
    id: VisibleTransactionId.make(idRaw),
    label: label ?? describeEvents(result.events),
    events: result.events,
    before,
    after: result.snapshot,
  }
}

/** Human label for the bundle, derived from its most significant events. */
export function describeEvents(events: readonly GameEvent[]): string {
  const tags = new Set(events.map((e) => e._tag))
  if (tags.has('folded') && tags.has('pot-awarded')) return 'Fold and award pot'
  if (tags.has('pot-split')) return 'Split pot'
  if (tags.has('pot-awarded') && tags.has('hand-settled')) return 'Award pots'
  if (tags.has('pot-awarded')) return 'Award pot'
  if (tags.has('rebuy-recorded')) return 'Rebuy'
  if (tags.has('buy-in-recorded')) return 'Buy-in'
  if (tags.has('cash-out-finalized')) return 'Cash-out'
  if (tags.has('correction-committed')) return 'Correction'
  if (tags.has('hand-cancelled')) return 'Cancel hand'
  if (tags.has('hand-started')) return 'Start hand'
  if (tags.has('street-advanced')) return 'Next street'
  const first = events[0]
  if (!first) return 'Table action'
  return describeSingleEvent(first)
}

// Friendly casing for plain single-event transactions so undo copy never
// reads "checked (checked)" (Slice 12 polish).
function describeSingleEvent(event: GameEvent): string {
  switch (event._tag) {
    case 'checked':
      return 'Check'
    case 'folded':
      return 'Fold'
    case 'called':
      return `Call ${event.amount}`
    case 'bet':
      return `Bet ${event.amount}`
    case 'raised':
      return `Raise to ${event.amount}`
    case 'all-in':
      return `All-in ${event.amount}`
    case 'sat-out':
      return 'Sit out'
    case 'returned-from-sit-out':
      return 'Return from sit-out'
    case 'seat-claimed':
      return 'Claim seat'
    case 'seat-released':
      return 'Release seat'
    case 'seat-reconnected':
      return 'Reclaim seat'
    case 'seat-interrupted':
      return 'Connection interrupted'
    case 'folded-player-restored':
      return 'Restore folded player'
    case 'active-player-set':
      return 'Set active player'
    case 'undo-committed':
      return 'Undo'
    case 'game-finished':
      return 'Finish game'
    case 'game-reset':
      return 'Reset game'
    case 'blinds-updated':
      return 'Change blinds'
    // Settings and setup family (post-verification F1: these are all
    // UI-reachable single-event commands from the manage drawer / setup).
    case 'strict-mode-updated':
      return event.enabled ? 'Strict mode on' : 'Strict mode off'
    case 'raise-rule-updated':
      return `Raise rule: ${event.rule}`
    case 'amount-step-updated':
      return 'Change amount step'
    case 'dealer-set':
      return 'Set dealer'
    case 'game-configured':
      return 'Game setup'
    case 'blind-posted':
      return 'Post blind'
    case 'game-created':
      return 'Create game'
    default:
      // Completeness (sweep, post-verification F1): every event the
      // reducers can emit as a SINGLE-event transaction has a case above;
      // pot-created and uncalled-bet-returned only occur inside bundles
      // (street-advance-to-showdown, uncontested award) that the bundle
      // rules in describeEvents label first. Only tags outside the union
      // reach this fallback.
      return event._tag
  }
}
