import type { GameEvent } from '../shared/schema/events'
import type { GameSnapshot } from '../shared/schema/snapshot'
import type { DomainError } from './state/errors'

// Soft-mode guardrails surface as warnings on an accepted action; strict
// mode turns the same conditions into errors (SPEC.md Soft Mode And Strict
// Mode). Reducers never throw — they return this union.
export interface ReducerWarning {
  code:
    | 'below-minimum-raise'
    | 'below-minimum-bet'
    | 'check-facing-bet'
    | 'betting-not-reopened'
    | 'call-with-nothing-owed'
  message: string
}

export interface ReducerOk {
  ok: true
  snapshot: GameSnapshot
  events: GameEvent[]
  warnings: ReducerWarning[]
}

export interface ReducerErr {
  ok: false
  error: DomainError
}

export type ReducerResult = ReducerOk | ReducerErr

export function ok(
  snapshot: GameSnapshot,
  events: GameEvent[],
  warnings: ReducerWarning[] = [],
): ReducerResult {
  return { ok: true, snapshot, events, warnings }
}

export function err(error: DomainError): ReducerResult {
  return { ok: false, error }
}
