import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createLogger,
  fileSink,
  serializeError,
  sweepLogs,
  truncateSessionId,
  type LogLine,
  type LogSink,
} from './logger'

const fixedClock = { now: () => Date.UTC(2026, 6, 2, 20, 15, 0) } // 2026-07-02T20:15:00Z

function memorySink(): { sink: LogSink; lines: LogLine[] } {
  const lines: LogLine[] = []
  return { sink: { write: (line) => lines.push(line) }, lines }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pcc-log-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('logger core', () => {
  it('emits structured lines with timestamp, level, event, msg, and fields', () => {
    const { sink, lines } = memorySink()
    const log = createLogger({ level: 'info', sinks: [sink], clock: fixedClock })
    log.info('socket.connect', 'phone connected', { gameCode: '48317' })

    expect(lines).toHaveLength(1)
    const line = lines[0]!
    expect(line.ts).toBe('2026-07-02T20:15:00.000Z')
    expect(line.level).toBe('info')
    expect(line.event).toBe('socket.connect')
    expect(line.msg).toBe('phone connected')
    expect(line.gameCode).toBe('48317')
  })

  it('filters below the configured level', () => {
    const { sink, lines } = memorySink()
    const log = createLogger({ level: 'warn', sinks: [sink], clock: fixedClock })
    log.debug('runtime.heartbeat', 'tick')
    log.info('socket.connect', 'joined')
    log.warn('socket.join_error', 'bad code')
    log.error('command.defect', 'boom')
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error'])
  })

  it('binds child context onto every line', () => {
    const { sink, lines } = memorySink()
    const log = createLogger({ level: 'info', sinks: [sink], clock: fixedClock })
    const gameLog = log.child({ gameId: 'game_1', code: '48317' })
    gameLog.info('command.accepted', 'fold accepted', { cmd: 'fold' })
    expect(lines[0]!.gameId).toBe('game_1')
    expect(lines[0]!.cmd).toBe('fold')
  })

  it('protects the line envelope: fields cannot override ts/level/event/msg', () => {
    const { sink, lines } = memorySink()
    const log = createLogger({ level: 'info', sinks: [sink], clock: fixedClock })
    log.info('client.log', 'shipped entry', {
      ts: 'forged',
      level: 'error',
      event: 'command.accepted',
      msg: 'forged',
      extra: 'kept',
    } as Record<string, unknown>)

    const line = lines[0]!
    expect(line.ts).toBe('2026-07-02T20:15:00.000Z')
    expect(line.level).toBe('info')
    expect(line.event).toBe('client.log')
    expect(line.msg).toBe('shipped entry')
    expect(line.extra).toBe('kept')
  })

  it('never throws when a sink fails', () => {
    const bad: LogSink = {
      write: () => {
        throw new Error('disk gone')
      },
    }
    const log = createLogger({ level: 'info', sinks: [bad], clock: fixedClock })
    expect(() => log.info('server.start', 'up')).not.toThrow()
  })

  it('serializes errors with name, message, and stack', () => {
    const err = serializeError(new RangeError('chips below zero'))
    expect(err.name).toBe('RangeError')
    expect(err.message).toBe('chips below zero')
    expect(err.stack).toContain('chips below zero')
  })

  it('truncates session ids to 8 characters', () => {
    expect(truncateSessionId('abcdefgh-1234-5678')).toBe('abcdefgh')
    expect(truncateSessionId('short')).toBe('short')
  })
})

describe('file sink', () => {
  it('appends NDJSON to a daily file named from the clock', () => {
    const sink = fileSink(dir, fixedClock)
    const log = createLogger({ level: 'info', sinks: [sink], clock: fixedClock })
    log.info('server.start', 'up', { port: 8080 })
    log.info('socket.connect', 'joined', { gameCode: '48317' })

    const file = path.join(dir, 'pcc-2026-07-02.ndjson')
    const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(rows).toHaveLength(2)
    expect(rows[0].event).toBe('server.start')
    expect(rows[1].gameCode).toBe('48317')
  })

  it('stays fast enough for synchronous appends at poker pace', () => {
    const sink = fileSink(dir, fixedClock)
    const log = createLogger({ level: 'info', sinks: [sink], clock: fixedClock })
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      log.info('command.accepted', 'action', { seq: i })
    }
    expect(performance.now() - start).toBeLessThan(1000)
  })
})

describe('retention sweep', () => {
  it('deletes files older than the age limit and keeps recent ones', () => {
    writeFileSync(path.join(dir, 'pcc-2026-06-01.ndjson'), '{}\n')
    writeFileSync(path.join(dir, 'pcc-2026-07-01.ndjson'), '{}\n')
    const deleted = sweepLogs(dir, { clock: fixedClock, maxAgeDays: 14 })
    expect(deleted).toContain('pcc-2026-06-01.ndjson')
    expect(readdirSync(dir)).toEqual(['pcc-2026-07-01.ndjson'])
  })

  it('enforces the total size cap, oldest first', () => {
    writeFileSync(path.join(dir, 'pcc-2026-06-25.ndjson'), 'x'.repeat(600))
    writeFileSync(path.join(dir, 'pcc-2026-07-01.ndjson'), 'x'.repeat(600))
    const deleted = sweepLogs(dir, {
      clock: fixedClock,
      maxAgeDays: 14,
      maxTotalBytes: 1000,
    })
    expect(deleted).toEqual(['pcc-2026-06-25.ndjson'])
    expect(readdirSync(dir)).toEqual(['pcc-2026-07-01.ndjson'])
  })
})
