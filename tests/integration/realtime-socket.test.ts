import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPokerServer, type PokerServer } from '../../src/server/app'
import { openDatabase, type AppDatabase } from '../../src/server/persistence/db'
import { migrate } from '../../src/server/persistence/migrations'
import type { GameSnapshot } from '../../src/domain/state/types'

let dir: string
let db: AppDatabase
let server: PokerServer
let port: number
let clients: Socket[] = []

const fixedClock = { now: () => 1_780_000_000_000 }
const sequentialIds = () => {
  let n = 0
  return { nextId: (prefix: string) => `${prefix}_${++n}` }
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'pcc-rt-'))
  db = openDatabase(path.join(dir, 'test.db'))
  migrate(db)
  server = createPokerServer({
    db,
    clock: fixedClock,
    ids: sequentialIds(),
    codes: { nextCode: () => '48317' },
  })
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = server.httpServer.address()
  if (typeof address === 'object' && address) port = address.port
})

afterEach(async () => {
  for (const client of clients) client.disconnect()
  clients = []
  await new Promise<void>((resolve) => {
    server.io.close(() => resolve())
  })
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve))
}

/** Resolve on the first room snapshot matching the predicate (broadcasts
 * from earlier commands may still be in flight). */
function waitForSnapshot(
  socket: Socket,
  predicate: (snapshot: GameSnapshot) => boolean,
): Promise<GameSnapshot> {
  return new Promise((resolve) => {
    const listener = ({ snapshot }: { snapshot: GameSnapshot }) => {
      if (predicate(snapshot)) {
        socket.off('snapshot', listener)
        resolve(snapshot)
      }
    }
    socket.on('snapshot', listener)
  })
}

async function connect(
  sessionId: string,
  gameCode: string,
): Promise<{ socket: Socket; snapshot: GameSnapshot }> {
  const socket = connectClient(`http://127.0.0.1:${port}`, {
    auth: { gameCode, sessionId },
    transports: ['websocket'],
  })
  clients.push(socket)
  const { snapshot } = await once<{ snapshot: GameSnapshot }>(socket, 'snapshot')
  return { socket, snapshot }
}

async function submit(
  socket: Socket,
  id: string,
  command: unknown,
): Promise<{ ok: boolean; reason?: string }> {
  const ack = once<{ id: string }>(socket, 'command-ack')
  const rejection = once<{ id: string; reason: string }>(socket, 'command-rejected')
  socket.emit('command', { id, command })
  const result = await Promise.race([
    ack.then(() => ({ ok: true })),
    rejection.then((r) => ({ ok: false, reason: r.reason })),
  ])
  return result
}

async function mustSubmit(socket: Socket, id: string, command: unknown) {
  const result = await submit(socket, id, command)
  expect(result.ok, `${id}: ${result.reason ?? ''}`).toBe(true)
}

/** Create a game and two connected, seated, bought-in players. */
async function twoSeatedPlayers() {
  const game = server.service.createGame({ creatorName: 'Host' })
  const pa = server.service.createProfile('Alex')
  const pb = server.service.createProfile('Sarah')
  const a = await connect('sess-a', game.code)
  const b = await connect('sess-b', game.code)
  await mustSubmit(a.socket, 'ca', {
    _tag: 'claim-seat',
    seatIndex: 0,
    profileId: pa.profileId,
  })
  await mustSubmit(b.socket, 'cb', {
    _tag: 'claim-seat',
    seatIndex: 1,
    profileId: pb.profileId,
  })
  const snapshot = server.service.getSnapshot(game.gameId)!
  const players = [...snapshot.players].sort((x, y) => x.seatIndex - y.seatIndex)
  await mustSubmit(a.socket, 'ba', {
    _tag: 'record-buy-in',
    playerId: players[0]!.id,
    money: { currency: 'EUR', cents: 1000 },
    chips: 1000,
  })
  await mustSubmit(b.socket, 'bb', {
    _tag: 'record-buy-in',
    playerId: players[1]!.id,
    money: { currency: 'EUR', cents: 1000 },
    chips: 1000,
  })
  await mustSubmit(a.socket, 'd', { _tag: 'set-dealer', seatIndex: 0 })
  return { game, a, b, pa, pb }
}

describe('realtime sessions', () => {
  it('ends terminally after a join-error: no reconnection remains scheduled (dogfood incident)', async () => {
    // Found via stored logs: an idle tab accumulated 1000+ reconnect
    // attempts across a host outage. Reconnection itself is load-bearing,
    // but once the server answers with join-error the connection must be
    // terminal — pinned here against BOTH the client handler and the
    // server's disconnect regressing.
    const { connectToGame } = await import('../../src/client/socket-client')
    const connection = connectToGame(
      '99999',
      'sess-storm',
      `http://127.0.0.1:${port}`,
    )
    clients.push(connection.socket)
    const reason = await new Promise<string>((resolve) =>
      connection.onJoinError(resolve),
    )
    expect(reason).toContain('unknown game code')

    // Give any (buggy) reconnection scheduling a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(connection.socket.connected).toBe(false)
    // active === true would mean the manager still plans to reconnect.
    expect(connection.socket.active).toBe(false)
  })

  it('rejects a missing session id before registering the socket, with a session-specific reason', async () => {
    const game = server.service.createGame({ creatorName: 'Host' })
    const socket = connectClient(`http://127.0.0.1:${port}`, {
      auth: { gameCode: game.code, sessionId: '' },
      transports: ['websocket'],
    })
    clients.push(socket)
    const error = await once<{ reason: string }>(socket, 'join-error')
    // Not 'unknown game code' — the code was valid; the session was not.
    expect(error.reason).toMatch(/session/i)
  })

  it('sends a full snapshot to every client joining the game room', async () => {
    const game = server.service.createGame({ creatorName: 'Host' })
    const a = await connect('sess-a', game.code)
    const b = await connect('sess-b', game.code)
    expect(a.snapshot.game.code).toBe('48317')
    expect(b.snapshot.game.code).toBe('48317')
  })

  it('broadcasts snapshots to the room and enforces active-seat actions', async () => {
    const { a, b } = await twoSeatedPlayers()
    const roomUpdate = waitForSnapshot(
      b.socket,
      (snapshot) => snapshot.game.status === 'in-hand',
    )
    await mustSubmit(a.socket, 's', { _tag: 'start-hand' })
    const update = await roomUpdate
    expect(update.game.status).toBe('in-hand')

    // Heads-up: dealer/seat 0 (client A) acts first; B is rejected.
    const rejected = await submit(b.socket, 'x', { _tag: 'check' })
    expect(rejected.ok).toBe(false)

    await mustSubmit(a.socket, 'a1', { _tag: 'call' })
  })

  it('locks an actively connected seat against other sessions', async () => {
    const game = server.service.createGame({ creatorName: 'Host' })
    const pa = server.service.createProfile('Alex')
    const pc = server.service.createProfile('Chris')
    const a = await connect('sess-a', game.code)
    const c = await connect('sess-c', game.code)
    await mustSubmit(a.socket, 'ca', {
      _tag: 'claim-seat',
      seatIndex: 0,
      profileId: pa.profileId,
    })
    const conflicting = await submit(c.socket, 'cc', {
      _tag: 'claim-seat',
      seatIndex: 0,
      profileId: pc.profileId,
    })
    expect(conflicting.ok).toBe(false)
  })

  it('marks seats interrupted on disconnect without auto-folding, keeps them reserved, and syncs missed events on reconnect', async () => {
    const { game, a, b } = await twoSeatedPlayers()
    await mustSubmit(a.socket, 's', { _tag: 'start-hand' })

    // A (dealer/SB) calls; B (BB) checks -> street closes, ready for flop.
    await mustSubmit(a.socket, 'a1', { _tag: 'call' })
    await mustSubmit(b.socket, 'b1', { _tag: 'check' })

    // B's phone dies mid-hand.
    const presence = once(a.socket, 'presence-updated')
    b.socket.disconnect()
    await presence

    const interrupted = server.service.getSnapshot(game.gameId)!
    const seatB = interrupted.players.find((p) => p.seatIndex === 1)!
    expect(seatB.connection).toBe('interrupted')
    // No auto-fold: the player is still live in the hand.
    expect(seatB.handStatus).not.toBe('folded')
    expect(interrupted.hand).not.toBeNull()

    // A stale session cannot steal the reserved seat.
    const pd = server.service.createProfile('Mallory')
    const d = await connect('sess-d', game.code)
    const steal = await submit(d.socket, 'st', {
      _tag: 'claim-seat',
      seatIndex: 1,
      profileId: pd.profileId,
    })
    expect(steal.ok).toBe(false)

    // Play continues while B is away: table confirms the flop.
    await mustSubmit(a.socket, 'ns', { _tag: 'confirm-next-street' })

    // B reconnects with the same silent session hint and reclaims the seat.
    const b2 = await connect('sess-b', game.code)
    // The join snapshot alone must cover everything B missed.
    expect(b2.snapshot.hand?.street).toBe('flop')
    const reclaim = await submit(b2.socket, 'rc', {
      _tag: 'claim-seat',
      seatIndex: 1,
      profileId: (await (async () => server.service.getSnapshot(game.gameId)!.players.find((p) => p.seatIndex === 1)!.profileId)()),
    })
    expect(reclaim.ok).toBe(true)
    const after = server.service.getSnapshot(game.gameId)!
    expect(after.players.find((p) => p.seatIndex === 1)?.connection).toBe(
      'connected',
    )
  })
})
