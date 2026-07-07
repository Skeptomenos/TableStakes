import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

import type { Clock } from './services'

// Structured NDJSON logging per ARCHITECTURE.md Observability And Logging.
// Design constraints: log calls can NEVER throw into gameplay code, file
// writes are synchronous so the last lines before a crash survive, and
// disk usage is bounded by a startup retention sweep.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

export interface LogLine {
  ts: string
  level: LogLevel
  event: string
  msg: string
  [key: string]: unknown
}

export interface LogSink {
  write(line: LogLine): void
}

export interface Logger {
  readonly level: LogLevel
  error(event: string, msg: string, fields?: Record<string, unknown>): void
  warn(event: string, msg: string, fields?: Record<string, unknown>): void
  info(event: string, msg: string, fields?: Record<string, unknown>): void
  debug(event: string, msg: string, fields?: Record<string, unknown>): void
  child(bindings: Record<string, unknown>): Logger
}

export interface CreateLoggerOptions {
  level?: LogLevel
  sinks: LogSink[]
  clock: Clock
}

export function parseLogLevel(value: string | undefined): LogLevel {
  return value === 'error' || value === 'warn' || value === 'info' || value === 'debug'
    ? value
    : 'info'
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const level = options.level ?? 'info'
  const threshold = LEVEL_ORDER[level]

  function make(bindings: Record<string, unknown>): Logger {
    const emit = (
      lineLevel: LogLevel,
      event: string,
      msg: string,
      fields?: Record<string, unknown>,
    ): void => {
      if (LEVEL_ORDER[lineLevel] > threshold) return
      // Envelope keys are written LAST: no field (including client-shipped
      // context) can ever forge ts/level/event/msg — the log is a
      // machine-readable diagnosis interface and its keys must be trusted.
      const line: LogLine = {
        ...bindings,
        ...fields,
        ts: new Date(options.clock.now()).toISOString(),
        level: lineLevel,
        event,
        msg,
      }
      for (const sink of options.sinks) {
        try {
          sink.write(line)
        } catch {
          // A broken sink must never break gameplay.
        }
      }
    }
    return {
      level,
      error: (event, msg, fields) => emit('error', event, msg, fields),
      warn: (event, msg, fields) => emit('warn', event, msg, fields),
      info: (event, msg, fields) => emit('info', event, msg, fields),
      debug: (event, msg, fields) => emit('debug', event, msg, fields),
      child: (childBindings) => make({ ...bindings, ...childBindings }),
    }
  }

  return make({})
}

export const noopLogger: Logger = createLogger({
  level: 'error',
  sinks: [],
  clock: { now: () => 0 },
})

/** Compact human line for the host terminal. */
export function consoleSink(): LogSink {
  return {
    write(line) {
      const { ts, level, event, msg, ...fields } = line
      const extras = Object.entries(fields)
        .map(([key, value]) =>
          `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`,
        )
        .join(' ')
      const time = ts.slice(11, 19)
      const out = `${time} ${level.toUpperCase().padEnd(5)} ${event} ${msg}${extras ? ' ' + extras : ''}`
      if (level === 'error') console.error(out)
      else if (level === 'warn') console.warn(out)
      else console.log(out)
    },
  }
}

/**
 * NDJSON appended synchronously to a daily file. After repeated write
 * failures the sink disables itself (one console notice) rather than
 * throwing into the game loop.
 */
export function fileSink(dir: string, clock: Clock): LogSink {
  let failures = 0
  let disabled = false
  mkdirSafe(dir)
  return {
    write(line) {
      if (disabled) return
      try {
        const day = new Date(clock.now()).toISOString().slice(0, 10)
        appendFileSync(
          path.join(dir, `pcc-${day}.ndjson`),
          JSON.stringify(line) + '\n',
        )
        failures = 0
      } catch (error) {
        failures += 1
        if (failures >= 3) {
          disabled = true
          console.error(
            `logging: file sink disabled after repeated failures: ${String(error)}`,
          )
        }
      }
    },
  }
}

function mkdirSafe(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // fileSink will fail and self-disable if the directory is unusable.
  }
}

export interface SweepOptions {
  clock: Clock
  maxAgeDays?: number
  maxTotalBytes?: number
}

/**
 * Startup retention sweep over daily log files: drop files older than the
 * age limit, then enforce the total-size cap oldest-first. Dates come from
 * filenames, so no mtime bookkeeping is needed.
 */
export function sweepLogs(dir: string, options: SweepOptions): string[] {
  const maxAgeDays = options.maxAgeDays ?? 14
  const maxTotalBytes = options.maxTotalBytes ?? 50 * 1024 * 1024
  const deleted: string[] = []
  let files: string[]
  try {
    files = readdirSync(dir)
      .filter((name) => /^pcc-\d{4}-\d{2}-\d{2}\.ndjson$/.test(name))
      .sort()
  } catch {
    return deleted
  }

  const cutoff = options.clock.now() - maxAgeDays * 24 * 60 * 60 * 1000
  const remaining: string[] = []
  for (const name of files) {
    const stamp = Date.parse(`${name.slice(4, 14)}T00:00:00Z`)
    if (Number.isFinite(stamp) && stamp < cutoff) {
      try {
        rmSync(path.join(dir, name))
        deleted.push(name)
      } catch {
        remaining.push(name)
      }
    } else {
      remaining.push(name)
    }
  }

  let total = 0
  const sizes = new Map<string, number>()
  for (const name of remaining) {
    try {
      const size = statSync(path.join(dir, name)).size
      sizes.set(name, size)
      total += size
    } catch {
      // ignore
    }
  }
  for (const name of remaining) {
    if (total <= maxTotalBytes) break
    try {
      rmSync(path.join(dir, name))
      deleted.push(name)
      total -= sizes.get(name) ?? 0
    } catch {
      // ignore
    }
  }
  return deleted
}

export function serializeError(error: unknown): {
  name: string
  message: string
  stack: string
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? '',
    }
  }
  return { name: 'UnknownError', message: String(error), stack: '' }
}

/** Session ids are silent reconnect hints: only 8 chars belong in logs. */
export function truncateSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}
