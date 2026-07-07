// Domain-facing re-exports of the shared state contract. Reducers and
// domain modules import from here so they stay framework-free and never
// reach into server or client code (plan Slice 2 verify rule).
export type {
  AmountStep,
  ConnectionStatus,
  GamePlayer,
  GameRecord,
  GameSettings,
  GameSnapshot,
  GameStatus,
  HandState,
  PlayerHandStatus,
  Pot,
  RaiseRule,
  SeatCommitment,
  Street,
} from '../../shared/schema/snapshot'
export type { ChipAmount } from '../../shared/chips'
export type { CentAmount, Money } from '../../shared/money'
export type {
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
} from '../../shared/schema/ids'
export type { EventEnvelope, GameEvent } from '../../shared/schema/events'
export type {
  CommandEnvelope,
  GameCommand,
} from '../../shared/schema/commands'
