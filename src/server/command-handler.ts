import { Data, Effect, Schema } from 'effect'

import type { ReducerOk } from '../domain/result'
import { applyGameCommand, type CommandContext } from '../domain/reducers/game-reducer'
import { GameCommand } from '../shared/schema/commands'
import type { GameSnapshot } from '../shared/schema/snapshot'

// The Effect command pipeline (ARCHITECTURE.md): decode -> guard
// (connection/session rules) -> build context -> reduce. Persistence and
// broadcast happen in the service AFTER this pipeline succeeds, preserving
// the persist-before-broadcast rule.

export class CommandDecodeFailure extends Data.TaggedError('CommandDecodeFailure')<{
  readonly reason: string
}> {}

export class CommandRejection extends Data.TaggedError('CommandRejection')<{
  readonly reason: string
}> {}

const decodeCommand = Schema.decodeUnknown(GameCommand)

export interface PipelineInput {
  snapshot: GameSnapshot
  raw: unknown
  /** Session-level guard (seat locks, hint rules); return a reason to reject. */
  guard: (command: GameCommand) => string | null
  buildContext: (command: GameCommand) => CommandContext
}

export interface PipelineOutcome {
  command: GameCommand
  result: ReducerOk
}

export function runCommandPipeline(
  input: PipelineInput,
): Effect.Effect<PipelineOutcome, CommandDecodeFailure | CommandRejection> {
  return Effect.gen(function* () {
    const command = yield* decodeCommand(input.raw).pipe(
      Effect.mapError(() => {
        // Keep decode failures to one line: the raw Schema pretty-print of
        // the whole command union is ~4KB and lands in phone error banners
        // and host logs (verification finding, Slices 8-9).
        const tag = (input.raw as { _tag?: unknown } | undefined)?._tag
        const named = typeof tag === 'string' ? ` (command: ${tag})` : ''
        return new CommandDecodeFailure({
          reason: `invalid command payload${named}`,
        })
      }),
    )

    const guardReason = input.guard(command)
    if (guardReason !== null) {
      return yield* new CommandRejection({ reason: guardReason })
    }

    const context = input.buildContext(command)
    const result = applyGameCommand(input.snapshot, command, context)
    if (!result.ok) {
      return yield* new CommandRejection({
        reason: `${result.error._tag}: ${describeError(result.error)}`,
      })
    }
    return { command, result }
  })
}

function describeError(error: object): string {
  const record = error as Record<string, unknown>
  if (typeof record.reason === 'string' && record.reason.length > 0) {
    return record.reason
  }
  // TaggedError extends Error, so message exists but may be empty — fall
  // through to the field dump so details like seatIndex are not lost.
  if (typeof record.message === 'string' && record.message.length > 0) {
    return record.message
  }
  return JSON.stringify(record)
}
