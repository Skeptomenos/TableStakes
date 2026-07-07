import { Data } from 'effect'

// Typed domain errors (ARCHITECTURE.md Effect Usage). Reducers fail with
// these; the command pipeline maps them to command-rejected responses.

export class NotActivePlayer extends Data.TaggedError('NotActivePlayer')<{
  readonly seatIndex: number
}> {}

export class SeatAlreadyClaimed extends Data.TaggedError('SeatAlreadyClaimed')<{
  readonly seatIndex: number
}> {}

export class InsufficientStack extends Data.TaggedError('InsufficientStack')<{
  readonly seatIndex: number
  readonly requested: number
  readonly available: number
}> {}

export class PotAllocationMismatch extends Data.TaggedError(
  'PotAllocationMismatch',
)<{
  readonly potId: string
  readonly potAmount: number
  readonly allocated: number
}> {}

export class StrictRuleViolation extends Data.TaggedError('StrictRuleViolation')<{
  readonly rule: string
  readonly message: string
}> {}

export class InvalidAction extends Data.TaggedError('InvalidAction')<{
  readonly reason: string
}> {}

export type DomainError =
  | NotActivePlayer
  | SeatAlreadyClaimed
  | InsufficientStack
  | PotAllocationMismatch
  | StrictRuleViolation
  | InvalidAction
