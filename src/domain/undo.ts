import { err, ok, type ReducerResult } from './result'
import { InvalidAction } from './state/errors'
import type { GameEvent, GameSnapshot } from './state/types'
import type { VisibleTransaction } from './visible-transactions'

/**
 * Why a visible transaction cannot be undone, or null when it can. The
 * single source for BOTH the reducer rejection and the preview flag, so
 * the drawer never advertises reversibility the server would refuse
 * (PR #182 review): a seat release deletes runtime claim/session state
 * that is not part of the snapshot and cannot be restored.
 */
export function nonUndoableReason(
  events: readonly GameEvent[],
): string | null {
  if (events.some((e) => e._tag === 'seat-released')) {
    return 'a seat release cannot be undone; the player can reclaim the seat instead'
  }
  // Finishing and finalizing write archive rows (finished_games,
  // cash_settlements) that a snapshot restore cannot revert — an "undone"
  // finish would leave a live game the restart path refuses to restore,
  // and re-finishing would collide with the archive row (verification F1).
  if (events.some((e) => e._tag === 'game-finished')) {
    return 'finishing the game cannot be undone; the game is archived in history'
  }
  if (events.some((e) => e._tag === 'cash-out-finalized')) {
    return 'the recorded settlement cannot be undone'
  }
  return null
}

/**
 * Undo the latest visible transaction by restoring the snapshot it started
 * from. Only the LATEST transaction may be undone: the current state must
 * still be exactly the transaction's after-state — anything newer requires
 * correction tools instead (SPEC.md Undo And Corrections).
 */
export function undoVisibleTransaction(
  snapshot: GameSnapshot,
  transaction: VisibleTransaction,
): ReducerResult {
  if (!deepEqual(snapshot, transaction.after)) {
    return err(
      new InvalidAction({
        reason:
          'only the latest visible transaction can be undone; use corrections for older mistakes',
      }),
    )
  }
  return ok(transaction.before, [
    { _tag: 'undo-committed', undoneTransactionId: transaction.id },
  ])
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  )
}
