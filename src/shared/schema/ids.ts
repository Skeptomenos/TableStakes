import { Schema } from 'effect'

// Opaque entity ids: non-empty branded strings. Generation format (prefix +
// random suffix) is a server service concern (Slice 5); schemas only require
// non-emptiness so deterministic test fixtures stay readable.
export const GameId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand('GameId'),
)
export type GameId = typeof GameId.Type

export const ProfileId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand('ProfileId'),
)
export type ProfileId = typeof ProfileId.Type

export const GamePlayerId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand('GamePlayerId'),
)
export type GamePlayerId = typeof GamePlayerId.Type

export const HandId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand('HandId'),
)
export type HandId = typeof HandId.Type

export const PotId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand('PotId'),
)
export type PotId = typeof PotId.Type

export const EventId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand('EventId'),
)
export type EventId = typeof EventId.Type

export const CommandId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand('CommandId'),
)
export type CommandId = typeof CommandId.Type

export const VisibleTransactionId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand('VisibleTransactionId'),
)
export type VisibleTransactionId = typeof VisibleTransactionId.Type

// Game URL shape per SPEC.md: /g/<five-digit-code>, numeric only. The stale
// Stitch alphanumeric examples (#A7B29) are explicitly invalid.
export const GameCode = Schema.String.pipe(
  Schema.pattern(/^[0-9]{5}$/),
  Schema.brand('GameCode'),
)
export type GameCode = typeof GameCode.Type

// Seats are 0-based internally (0-9); UI displays seat 1-10 (DESIGN.md).
export const SeatIndex = Schema.Number.pipe(
  Schema.int(),
  Schema.between(0, 9),
  Schema.brand('SeatIndex'),
)
export type SeatIndex = typeof SeatIndex.Type

export const EpochMillis = Schema.Number.pipe(
  Schema.int(),
  Schema.between(0, Number.MAX_SAFE_INTEGER),
  Schema.brand('EpochMillis'),
)
export type EpochMillis = typeof EpochMillis.Type
