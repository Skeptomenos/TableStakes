import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPokerServer, type PokerServer } from '../../src/server/app'
import { createLogger, type LogLine, type LogSink } from '../../src/server/logger'
import { openDatabase, type AppDatabase } from '../../src/server/persistence/db'
import { migrate } from '../../src/server/persistence/migrations'

let dir: string
let db: AppDatabase
let server: PokerServer
let port: number
let lines: LogLine[]
let clients: Socket[] = []

const fixedClock = { now: () => 1_780_000_000_000 }

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'pcc-obslog-'))
  db = openDatabase(path.join(dir, 'test.db'))
  migrate(db)
  lines = []
  const sink: LogSink = { write: (line) => lines.push(line) }
  let n = 0
  server = createPokerServer({
    db,
    clock: fixedClock,
    ids: { nextId: (prefix: string) => `${prefix}_${++n}` },
    codes: { nextCode: () => '48317' },
    logger: createLogger({ level: 'debug', sinks: [sink], clock: fixedClock }),
  })
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = server.httpServer.address()
  if (typeof address === 'object' && address) port = address.port
})

afterEach(async () => {
  for (const c of clients) c.disconnect()
  clients = []
  await new Promise<void>((resolve) => {
    server.io.close(() => resolve())
  })
  try {
    db.close()
  } catch {
    // some tests close the db themselves
  }
  rmSync(dir, { recursive: true, force: true })
})

const find = (event: string) => lines.filter((l) => l.event === event)

function session(sessionId: string) {
  return { gameCode: '48317', sessionId, socketId: `sock-${sessionId}` }
}

describe('command flow logging', () => {
  it('logs accepted commands with vtx id and duration, and rejections with reasons', () => {
    const game = server.service.createGame({ creatorName: 'Host' })
    server.service.join(session('sess-a'))
    const profile = server.service.createProfile('Alex')

    const claim = {
      _tag: 'claim-seat',
      seatIndex: 0,
      profileId: profile.profileId,
    }
    server.service.processCommand(session('sess-a'), { id: 'c1', command: claim })

    const accepted = find('command.accepted')
    expect(accepted.length).toBeGreaterThan(0)
    const line = accepted.find((l) => l.cmd === 'claim-seat')!
    expect(line).toBeDefined()
    expect(line.code).toBe(game.code)
    expect(String(line.vtx)).toContain('vtx')
    expect(typeof line.durMs).toBe('number')

    // Same session claims its own connected seat again -> rejection logged.
    server.service.processCommand(session('sess-a'), { id: 'c2', command: claim })
    const rejected = find('command.rejected')
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0]!.reason)).toContain('SeatAlreadyClaimed')
  })

  it('logs pipeline DEFECTS with their full cause instead of swallowing them', () => {
    server.service.createGame({ creatorName: 'Host' })
    server.service.join(session('sess-a'))
    const profile = server.service.createProfile('Alex')

    // Pull the database out from under the service: the guard's profile
    // lookup now throws, which is a defect, not a typed rejection.
    db.close()
    const outcome = server.service.processCommand(session('sess-a'), {
      id: 'c1',
      command: { _tag: 'claim-seat', seatIndex: 0, profileId: profile.profileId },
    })
    expect(outcome.status).toBe('rejected')

    const defects = find('command.defect')
    expect(defects).toHaveLength(1)
    expect(defects[0]!.level).toBe('error')
    expect(String(defects[0]!.cause)).toMatch(/database|not open/i)
  })
})

describe('socket lifecycle logging', () => {
  it('logs connect and disconnect with the Socket.IO reason', async () => {
    server.service.createGame({ creatorName: 'Host' })
    const socket = connectClient(`http://127.0.0.1:${port}`, {
      auth: { gameCode: '48317', sessionId: 'sess-a' },
      transports: ['websocket'],
    })
    clients.push(socket)
    await new Promise<void>((resolve) => socket.once('snapshot', () => resolve()))
    expect(find('socket.connect')).toHaveLength(1)

    socket.disconnect()
    await new Promise<void>((resolve) => {
      const check = () =>
        find('socket.disconnect').length > 0 ? resolve() : setTimeout(check, 10)
      check()
    })
    const line = find('socket.disconnect')[0]!
    expect(String(line.reason)).toContain('disconnect')
    expect(line.gameCode).toBe('48317')
  })

  it('logs join errors with a reason', async () => {
    const socket = connectClient(`http://127.0.0.1:${port}`, {
      auth: { gameCode: '99999', sessionId: 'sess-x' },
      transports: ['websocket'],
    })
    clients.push(socket)
    await new Promise<void>((resolve) => socket.once('join-error', () => resolve()))
    expect(find('socket.join_error')).toHaveLength(1)
  })
})

describe('client log shipping', () => {
  it('accepts capped batches and writes them through the server logger', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/client-logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'sess-phone-1234567890',
        gameCode: '48317',
        entries: [
          {
            level: 'error',
            event: 'react.error',
            msg: 'render crashed',
            context: { stack: 'Error: render crashed' },
          },
          { level: 'warn', event: 'socket.disconnect', msg: 'transport close' },
        ],
      }),
    })
    expect(res.status).toBe(204)

    const shipped = find('client.log')
    expect(shipped).toHaveLength(2)
    expect(shipped[0]!.source).toBe('client')
    // Session ids are truncated in log output.
    expect(shipped[0]!.sid).toBe('sess-pho')
    expect(shipped[0]!.origin).toBe('react.error')
    expect(shipped.map((l) => l.level)).toEqual(['error', 'warn'])
  })

  it('cannot be forged: client context never overrides event, source, or sid (verification finding)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/client-logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'sess-real-1234567890',
        entries: [
          {
            level: 'info',
            event: 'x',
            msg: 'sneaky',
            context: {
              event: 'command.accepted',
              source: 'server',
              sid: 'forged-sid',
              level: 'error',
              ts: 'forged',
            },
          },
        ],
      }),
    })
    expect(res.status).toBe(204)

    const shipped = find('client.log')
    expect(shipped).toHaveLength(1)
    const line = shipped[0]!
    // The stamped envelope and identity fields always win.
    expect(line.event).toBe('client.log')
    expect(line.source).toBe('client')
    expect(line.sid).toBe('sess-rea')
    expect(line.level).toBe('info')
    expect(find('command.accepted')).toHaveLength(0)
  })

  it('rejects oversized batches', async () => {
    const entries = Array.from({ length: 51 }, (_, i) => ({
      level: 'warn',
      event: 'x',
      msg: `entry ${i}`,
    }))
    const res = await fetch(`http://127.0.0.1:${port}/api/client-logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's', entries }),
    })
    expect(res.status).toBe(400)
    expect(find('client.log')).toHaveLength(0)
  })
})
