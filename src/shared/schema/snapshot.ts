import { Schema } from 'effect'

import { ChipAmount } from '../chips'
import { CentAmount, CurrencyCode } from '../money'
import {
  EpochMillis,
  GameCode,
  GameId,
  GamePlayerId,
  HandId,
  PotId,
  ProfileId,
  SeatIndex,
} from './ids'

// State vocabulary (ARCHITECTURE.md Game State Machine). `settling` was
// removed in Slice 12: no reducer ever produced it — mid-settlement stays
// `showdown` until the hand closes (Slice 3 decision).
export const GameStatus = Schema.Literal(
  'setup',
  'between-hands',
  'in-hand',
  'showdown',
  'finished',
)
export type GameStatus = typeof GameStatus.Type

export const Street = Schema.Literal(
  'pre-flop',
  'flop',
  'turn',
  'river',
  'showdown',
)
export type Street = typeof Street.Type

export const PlayerHandStatus = Schema.Literal(
  'waiting',
  'active',
  'folded',
  'all-in',
  'out-of-hand',
  'sitting-out',
  'needs-rebuy',
)
export type PlayerHandStatus = typeof PlayerHandStatus.Type

export const ConnectionStatus = Schema.Literal(
  'connected',
  'interrupted',
  'reserved',
  'released',
)
export type ConnectionStatus = typeof ConnectionStatus.Type

export const RaiseRule = Schema.Literal('any', 'double', 'standard')
export type RaiseRule = typeof RaiseRule.Type

// Amount step (SPEC.md game settings): UI presets 5/10 and custom values all
// map to a fixed chip step; the follow variants track the current blinds.
export const AmountStep = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('fixed'),
    chips: ChipAmount.pipe(Schema.greaterThan(0)),
  }),
  Schema.Struct({ kind: Schema.Literal('follow-small-blind') }),
  Schema.Struct({ kind: Schema.Literal('follow-big-blind') }),
)
export type AmountStep = typeof AmountStep.Type

export const GameSettings = Schema.Struct({
  currency: CurrencyCode,
  defaultBuyInCents: CentAmount,
  defaultStack: ChipAmount,
  smallBlind: ChipAmount,
  bigBlind: ChipAmount,
  strictMode: Schema.Boolean,
  raiseRule: RaiseRule,
  amountStep: AmountStep,
})
export type GameSettings = typeof GameSettings.Type

// Contributors fund a pot; eligible winners can receive it. Folded players
// stay contributors but leave the eligible set (chip conservation).
export const Pot = Schema.Struct({
  id: PotId,
  label: Schema.String.pipe(Schema.minLength(1)),
  amount: ChipAmount,
  contributorIds: Schema.Array(GamePlayerId),
  eligiblePlayerIds: Schema.Array(GamePlayerId),
  allInThreshold: Schema.NullOr(ChipAmount),
})
export type Pot = typeof Pot.Type

export const SeatCommitment = Schema.Struct({
  seatIndex: SeatIndex,
  street: ChipAmount,
  total: ChipAmount,
})
export type SeatCommitment = typeof SeatCommitment.Type

export const HandState = Schema.Struct({
  id: HandId,
  handNumber: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  dealerSeat: SeatIndex,
  smallBlindSeat: SeatIndex,
  bigBlindSeat: SeatIndex,
  street: Street,
  activeSeat: Schema.NullOr(SeatIndex),
  currentBet: ChipAmount,
  minRaiseTo: ChipAmount,
  // Size of the last full bet/raise on this street (standard-rule minimums)
  // and the highest bet-to that was a FULL raise: an all-in below the rule
  // minimum raises currentBet but not lastFullRaiseTo, and does not reopen
  // betting for players who already acted (SPEC.md Raise Rules).
  lastRaiseSize: ChipAmount,
  lastFullRaiseTo: ChipAmount,
  actedSeats: Schema.Array(SeatIndex),
  nextStreetReady: Schema.Boolean,
  commitments: Schema.Array(SeatCommitment),
})
export type HandState = typeof HandState.Type

export const GamePlayer = Schema.Struct({
  id: GamePlayerId,
  profileId: ProfileId,
  name: Schema.String.pipe(Schema.minLength(1)),
  seatIndex: SeatIndex,
  stack: ChipAmount,
  handStatus: PlayerHandStatus,
  connection: ConnectionStatus,
  sitOutNextHand: Schema.Boolean,
  totalBuyInCents: CentAmount,
  totalChipsPurchased: ChipAmount,
  pendingRebuyChips: ChipAmount,
})
export type GamePlayer = typeof GamePlayer.Type

export const GameRecord = Schema.Struct({
  id: GameId,
  code: GameCode,
  status: GameStatus,
  settings: GameSettings,
  creatorProfileId: ProfileId,
  // Dealer position between hands: set in setup, advanced after each
  // settled hand (skipping busted/empty/sitting-out seats), unchanged by
  // cancel-hand. Null until setup selects a dealer.
  dealerSeat: Schema.NullOr(SeatIndex),
  // Blind/strict-mode/raise-rule changes apply from the NEXT hand
  // (SPEC.md): mid-hand changes wait here and land in closeHand.
  pendingSettings: Schema.NullOr(GameSettings),
  lastHandNumber: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(0),
  ),
  createdAt: EpochMillis,
  updatedAt: EpochMillis,
})
export type GameRecord = typeof GameRecord.Type

// Server-renderable canonical state. Clients render snapshots; they never
// mutate chip balances locally (ARCHITECTURE.md Runtime Topology).
export const GameSnapshot = Schema.Struct({
  game: GameRecord,
  players: Schema.Array(GamePlayer),
  hand: Schema.NullOr(HandState),
  pots: Schema.Array(Pot),
  eventCursor: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
})
export type GameSnapshot = typeof GameSnapshot.Type
