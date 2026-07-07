import { Schema } from 'effect'

import { ChipAmount } from '../chips'
import { Money } from '../money'
import {
  CommandId,
  GameId,
  GamePlayerId,
  PotId,
  ProfileId,
  SeatIndex,
  VisibleTransactionId,
} from './ids'
import {
  CashTransfer,
  SplitAllocation,
  ZeroSumCorrectionMoves,
} from './events'
import { AmountStep, GameSettings, RaiseRule } from './snapshot'

const PositiveChips = ChipAmount.pipe(Schema.greaterThan(0))

// Client requests to change game state (ARCHITECTURE.md Command Pipeline).
// Game and profile creation happen before a game room exists and go through
// HTTP routes (Slice 6/7), so they are not part of this in-game union.
// Normal poker actions carry no seat: the server derives the acting seat
// from the authenticated connection claim, never from the payload.
export const GameCommand = Schema.Union(
  // Seats
  Schema.TaggedStruct('claim-seat', {
    seatIndex: SeatIndex,
    profileId: ProfileId,
  }),
  Schema.TaggedStruct('release-seat', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('mark-interrupted-folded', { seatIndex: SeatIndex }),
  // Setup and settings (shared, audited). Seat reorder is deliberately NOT
  // a command: SPEC.md keeps it optional row-level setup out of MVP, and a
  // schema-only command would just rot (Slice 12; drift check enforces
  // union == dispatch).
  Schema.TaggedStruct('configure-game', { settings: GameSettings }),
  Schema.TaggedStruct('set-dealer', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('update-blinds', {
    smallBlind: PositiveChips,
    bigBlind: PositiveChips,
  }),
  Schema.TaggedStruct('update-strict-mode', { enabled: Schema.Boolean }),
  Schema.TaggedStruct('update-raise-rule', { rule: RaiseRule }),
  Schema.TaggedStruct('update-amount-step', { step: AmountStep }),
  // Hand lifecycle
  Schema.TaggedStruct('start-hand', {}),
  Schema.TaggedStruct('confirm-next-street', {}),
  Schema.TaggedStruct('cancel-hand', {}),
  // Normal poker actions (active claimed seat only)
  Schema.TaggedStruct('fold', {}),
  Schema.TaggedStruct('check', {}),
  Schema.TaggedStruct('call', {}),
  Schema.TaggedStruct('bet', { amount: PositiveChips }),
  Schema.TaggedStruct('raise', { amount: PositiveChips }),
  Schema.TaggedStruct('go-all-in', {}),
  // Settlement (shared, audited)
  Schema.TaggedStruct('award-pot', { potId: PotId, winnerId: GamePlayerId }),
  Schema.TaggedStruct('split-pot', {
    potId: PotId,
    allocations: Schema.Array(SplitAllocation).pipe(Schema.minItems(1)),
  }),
  Schema.TaggedStruct('take-all-eligible-pots', { winnerId: GamePlayerId }),
  // Recovery and table management (shared, audited)
  Schema.TaggedStruct('undo', {
    expectedTransactionId: Schema.optional(VisibleTransactionId),
  }),
  Schema.TaggedStruct('apply-correction', {
    reason: Schema.String.pipe(Schema.minLength(1)),
    moves: ZeroSumCorrectionMoves,
  }),
  Schema.TaggedStruct('restore-folded-player', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('set-active-player', { seatIndex: SeatIndex }),
  Schema.TaggedStruct('sit-out', {}),
  Schema.TaggedStruct('return-from-sit-out', {}),
  // Money
  Schema.TaggedStruct('record-buy-in', {
    playerId: GamePlayerId,
    money: Money,
    chips: PositiveChips,
  }),
  Schema.TaggedStruct('record-rebuy', {
    playerId: GamePlayerId,
    money: Money,
    chips: PositiveChips,
  }),
  Schema.TaggedStruct('finish-game', {}),
  Schema.TaggedStruct('finalize-cash-out', {
    transfers: Schema.Array(CashTransfer),
  }),
  Schema.TaggedStruct('reset-game', {}),
)
export type GameCommand = typeof GameCommand.Type

export const CommandEnvelope = Schema.Struct({
  id: CommandId,
  gameId: GameId,
  actorProfileId: ProfileId,
  command: GameCommand,
})
export type CommandEnvelope = typeof CommandEnvelope.Type
