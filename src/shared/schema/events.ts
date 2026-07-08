import { Schema } from 'effect'

import { ChipAmount } from '../chips'
import { CentAmount, Money } from '../money'
import {
  EpochMillis,
  EventId,
  GameCode,
  GameId,
  GamePlayerId,
  HandId,
  PotId,
  ProfileId,
  SeatIndex,
  VisibleTransactionId,
} from './ids'
import { AmountStep, GameSettings, RaiseRule, Street } from './snapshot'

// Corrections are zero-sum: chips move between stacks and pots but the total
// chips in play never change (SPEC.md Undo And Corrections).
export const CorrectionTarget = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('player-stack'),
    playerId: GamePlayerId,
  }),
  Schema.Struct({ kind: Schema.Literal('pot'), potId: PotId }),
)
export type CorrectionTarget = typeof CorrectionTarget.Type

export const CorrectionMove = Schema.Struct({
  target: CorrectionTarget,
  delta: Schema.Number.pipe(
    Schema.int(),
    Schema.between(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    Schema.filter((n) => n !== 0 || 'correction move delta must be non-zero'),
  ),
})
export type CorrectionMove = typeof CorrectionMove.Type

export const ZeroSumCorrectionMoves = Schema.Array(CorrectionMove).pipe(
  Schema.minItems(1),
  Schema.filter(
    (moves) =>
      moves.reduce((sum, move) => sum + move.delta, 0) === 0 ||
      'correction moves must sum to zero (zero-sum invariant)',
  ),
)

export const SplitAllocation = Schema.Struct({
  playerId: GamePlayerId,
  chips: ChipAmount.pipe(Schema.greaterThan(0)),
})
export type SplitAllocation = typeof SplitAllocation.Type

export const CashTransfer = Schema.Struct({
  fromProfileId: ProfileId,
  toProfileId: ProfileId,
  cents: CentAmount,
})
export type CashTransfer = typeof CashTransfer.Type

// Append-only event families (ARCHITECTURE.md Events).
export const GameEvent = Schema.Union(
  // Game lifecycle
  Schema.TaggedStruct('game-created', {
    code: GameCode,
    // Null for console-created tables (ADR 0002): no profile is required to
    // create a game; the audit records console origin instead.
    creatorProfileId: Schema.NullOr(ProfileId),
  }),
  Schema.TaggedStruct('game-configured', { settings: GameSettings }),
  Schema.TaggedStruct('game-reset', {}),
  Schema.TaggedStruct('game-finished', {}),
  // Profiles and seats
  Schema.TaggedStruct('profile-created', {
    profileId: ProfileId,
    name: Schema.String.pipe(Schema.minLength(1)),
  }),
  Schema.TaggedStruct('seat-claimed', {
    seatIndex: SeatIndex,
    playerId: GamePlayerId,
    profileId: ProfileId,
  }),
  Schema.TaggedStruct('seat-released', {
    seatIndex: SeatIndex,
    playerId: GamePlayerId,
  }),
  Schema.TaggedStruct('seat-interrupted', {
    seatIndex: SeatIndex,
    playerId: GamePlayerId,
  }),
  Schema.TaggedStruct('seat-reconnected', {
    seatIndex: SeatIndex,
    playerId: GamePlayerId,
  }),
  // Setup and settings. Seat reorder stays out of MVP (SPEC.md optional
  // row-level setup), so there is no players-reordered event (Slice 12).
  Schema.TaggedStruct('dealer-set', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('blinds-updated', {
    smallBlind: ChipAmount,
    bigBlind: ChipAmount,
  }),
  Schema.TaggedStruct('strict-mode-updated', { enabled: Schema.Boolean }),
  Schema.TaggedStruct('raise-rule-updated', { rule: RaiseRule }),
  Schema.TaggedStruct('amount-step-updated', { step: AmountStep }),
  // Hand lifecycle
  Schema.TaggedStruct('hand-started', {
    handNumber: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
    dealerSeat: SeatIndex,
    smallBlindSeat: SeatIndex,
    bigBlindSeat: SeatIndex,
  }),
  Schema.TaggedStruct('blind-posted', {
    seatIndex: SeatIndex,
    kind: Schema.Literal('small', 'big'),
    amount: ChipAmount,
  }),
  Schema.TaggedStruct('street-advanced', { street: Street }),
  Schema.TaggedStruct('hand-cancelled', {}),
  Schema.TaggedStruct('hand-settled', {}),
  // Player actions
  Schema.TaggedStruct('folded', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('checked', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('called', { seatIndex: SeatIndex, amount: ChipAmount }),
  Schema.TaggedStruct('bet', { seatIndex: SeatIndex, amount: ChipAmount }),
  Schema.TaggedStruct('raised', { seatIndex: SeatIndex, amount: ChipAmount }),
  Schema.TaggedStruct('all-in', { seatIndex: SeatIndex, amount: ChipAmount }),
  // Pots
  // Extension beyond ARCHITECTURE.md's initial families (Decision Log
  // 2026-07-02): the uncalled portion of a bet returns to the bettor at pot
  // construction and must stay auditable.
  Schema.TaggedStruct('uncalled-bet-returned', {
    seatIndex: SeatIndex,
    amount: ChipAmount,
  }),
  Schema.TaggedStruct('pot-created', {
    potId: PotId,
    label: Schema.String.pipe(Schema.minLength(1)),
  }),
  Schema.TaggedStruct('pot-awarded', {
    potId: PotId,
    winnerId: GamePlayerId,
    amount: ChipAmount,
  }),
  Schema.TaggedStruct('pot-split', {
    potId: PotId,
    allocations: Schema.Array(SplitAllocation).pipe(Schema.minItems(1)),
  }),
  // Recovery
  Schema.TaggedStruct('undo-committed', {
    undoneTransactionId: VisibleTransactionId,
  }),
  Schema.TaggedStruct('correction-committed', {
    reason: Schema.String.pipe(Schema.minLength(1)),
    moves: ZeroSumCorrectionMoves,
  }),
  // Named correction tools and sit-out lifecycle (Slice 10): state fixes
  // are their own audited events, never disguised as chip moves.
  Schema.TaggedStruct('folded-player-restored', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('active-player-set', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('sat-out', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('returned-from-sit-out', { seatIndex: SeatIndex }),
  // Money
  Schema.TaggedStruct('buy-in-recorded', {
    playerId: GamePlayerId,
    money: Money,
    chips: ChipAmount,
  }),
  Schema.TaggedStruct('rebuy-recorded', {
    playerId: GamePlayerId,
    money: Money,
    chips: ChipAmount,
  }),
  Schema.TaggedStruct('cash-out-finalized', {
    transfers: Schema.Array(CashTransfer),
  }),
)
export type GameEvent = typeof GameEvent.Type

// Envelope persisted to the append-only event log. Every event belongs to a
// visible transaction — the unit undo operates on.
export const EventEnvelope = Schema.Struct({
  id: EventId,
  gameId: GameId,
  handId: Schema.NullOr(HandId),
  visibleTransactionId: VisibleTransactionId,
  actorProfileId: Schema.NullOr(ProfileId),
  timestamp: EpochMillis,
  event: GameEvent,
})
export type EventEnvelope = typeof EventEnvelope.Type
