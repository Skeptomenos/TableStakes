import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GameService, type Broadcaster } from '../../src/server/game-service'
import { openDatabase, type AppDatabase } from '../../src/server/persistence/db'
import { listEventsAfter } from '../../src/server/persistence/event-store'
import { getFinishedGame } from '../../src/server/persistence/finished-game-store'
import { listActiveGames } from '../../src/server/persistence/game-store'
import { migrate } from '../../src/server/persistence/migrations'
import type { Clock, CodeGenerator, IdGenerator } from '../../src/server/services'

let dir: string
let dbPath: string
let db: AppDatabase

const fixedClock: Clock = { now: () => 1_780_000_000_000 }
const sequentialIds = (): IdGenerator => {
  let n = 0
  return { nextId: (prefix) => `${prefix}_${++n}` }
}
const fixedCodes: CodeGenerator = { nextCode: () => '48317' }

interface BroadcastLog {
  snapshotsSeenEvents: number[]
  presence: number
}

function spyBroadcaster(log: BroadcastLog, gameIdRef: { id: string }): Broadcaster {
  return {
    emitSnapshot: () => {
      // Record how many events were durably persisted at broadcast time.
      log.snapshotsSeenEvents.push(
        listEventsAfter(db, gameIdRef.id, 0).length,
      )
    },
    emitEvents: () => {},
    emitPresence: () => {
      log.presence += 1
    },
  }
}

function makeService(log: BroadcastLog, gameIdRef: { id: string }) {
  return new GameService({
    db,
    clock: fixedClock,
    ids: sequentialIds(),
    codes: fixedCodes,
    broadcaster: spyBroadcaster(log, gameIdRef),
  })
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pcc-pipe-'))
  dbPath = path.join(dir, 'test.db')
  db = openDatabase(dbPath)
  migrate(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const sessionA = { sessionId: 'sess-a', socketId: 'sock-a' }
const sessionB = { sessionId: 'sess-b', socketId: 'sock-b' }

describe('command pipeline', () => {
  it('rejects commands that fail schema decode', () => {
    const log: BroadcastLog = { snapshotsSeenEvents: [], presence: 0 }
    const ref = { id: '' }
    const service = makeService(log, ref)
    const game = service.createGame({ creatorName: 'Alex' })
    ref.id = game.gameId
    service.join({ gameCode: game.code, ...sessionA })

    const result = service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'c1', command: { _tag: 'deal-cards' } },
    )
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') {
      // Decode failures must stay a one-liner: phones render the reason in
      // the error banner and it lands in host logs (verification finding —
      // the raw Schema pretty-print of the whole command union is ~4KB).
      expect(result.reason.length).toBeLessThan(200)
      expect(result.reason).toContain('deal-cards')
    }
  })

  it('accepts a seat claim and persists events BEFORE broadcasting', () => {
    const log: BroadcastLog = { snapshotsSeenEvents: [], presence: 0 }
    const ref = { id: '' }
    const service = makeService(log, ref)
    const game = service.createGame({ creatorName: 'Alex' })
    ref.id = game.gameId
    service.join({ gameCode: game.code, ...sessionA })
    const profile = service.createProfile('Sarah')

    const eventsBefore = listEventsAfter(db, game.gameId, 0).length
    const result = service.processCommand(
      { gameCode: game.code, ...sessionA },
      {
        id: 'c1',
        command: {
          _tag: 'claim-seat',
          seatIndex: 0,
          profileId: profile.profileId,
        },
      },
    )
    expect(result.status).toBe('ack')

    // The broadcast fired after the new events were already durable.
    const eventsAfter = listEventsAfter(db, game.gameId, 0).length
    expect(eventsAfter).toBeGreaterThan(eventsBefore)
    expect(log.snapshotsSeenEvents.at(-1)).toBe(eventsAfter)
  })

  it('locks actively claimed seats and rejects non-active poker actions', () => {
    const log: BroadcastLog = { snapshotsSeenEvents: [], presence: 0 }
    const ref = { id: '' }
    const service = makeService(log, ref)
    const game = service.createGame({ creatorName: 'Alex' })
    ref.id = game.gameId
    service.join({ gameCode: game.code, ...sessionA })
    service.join({ gameCode: game.code, ...sessionB })

    const p1 = service.createProfile('Alex')
    const p2 = service.createProfile('Sarah')
    const claim = (session: typeof sessionA, seatIndex: number, profileId: string) =>
      service.processCommand(
        { gameCode: game.code, ...session },
        { id: `claim-${seatIndex}-${session.sessionId}`, command: { _tag: 'claim-seat', seatIndex, profileId } },
      )

    expect(claim(sessionA, 0, p1.profileId).status).toBe('ack')
    // Active seat lock: another live session cannot take seat 0.
    expect(claim(sessionB, 0, p2.profileId).status).toBe('rejected')
    expect(claim(sessionB, 1, p2.profileId).status).toBe('ack')

    const snapshot = service.getSnapshot(game.gameId)!
    const playerIds = [...snapshot.players]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((p) => p.id)

    const run = (session: typeof sessionA, id: string, command: unknown) =>
      service.processCommand({ gameCode: game.code, ...session }, { id, command })

    expect(
      run(sessionA, 'b1', {
        _tag: 'record-buy-in',
        playerId: playerIds[0],
        money: { currency: 'EUR', cents: 1000 },
        chips: 1000,
      }).status,
    ).toBe('ack')
    expect(
      run(sessionB, 'b2', {
        _tag: 'record-buy-in',
        playerId: playerIds[1],
        money: { currency: 'EUR', cents: 1000 },
        chips: 1000,
      }).status,
    ).toBe('ack')
    expect(run(sessionA, 'd1', { _tag: 'set-dealer', seatIndex: 0 }).status).toBe('ack')
    expect(run(sessionA, 's1', { _tag: 'start-hand' }).status).toBe('ack')

    // Heads-up: dealer (seat 0, session A) acts first. B cannot act.
    const rejected = run(sessionB, 'x1', { _tag: 'check' })
    expect(rejected.status).toBe('rejected')

    // Audited table actions stay available to non-active connected players.
    const tableAction = run(sessionB, 't1', {
      _tag: 'update-blinds',
      smallBlind: 100,
      bigBlind: 200,
    })
    expect(tableAction.status).toBe('ack')

    // The active seat's normal action is accepted.
    expect(run(sessionA, 'a1', { _tag: 'call' }).status).toBe('ack')
  })

  it('carries domain error details into rejection reasons (verification finding)', () => {
    const log: BroadcastLog = { snapshotsSeenEvents: [], presence: 0 }
    const ref = { id: '' }
    const service = makeService(log, ref)
    const game = service.createGame({ creatorName: 'Alex' })
    ref.id = game.gameId
    service.join({ gameCode: game.code, ...sessionA })
    const profile = service.createProfile('Alex')
    const claim = {
      _tag: 'claim-seat',
      seatIndex: 0,
      profileId: profile.profileId,
    }
    service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'c1', command: claim },
    )
    // Same session re-claims its own connected seat: domain rejects with
    // SeatAlreadyClaimed, whose details must survive into the reason.
    const result = service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'c2', command: claim },
    )
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') {
      expect(result.reason).toContain('SeatAlreadyClaimed')
      expect(result.reason).toContain('seatIndex')
    }
  })

  it('archives finished games durably so restarts do not resurrect them (PR #171 review)', () => {
    const log: BroadcastLog = { snapshotsSeenEvents: [], presence: 0 }
    const ref = { id: '' }
    const service = makeService(log, ref)
    const game = service.createGame({ creatorName: 'Alex' })
    ref.id = game.gameId
    service.join({ gameCode: game.code, ...sessionA })
    // Someone must be seated: finishing an empty game is rejected (Slice 12).
    const profile = service.createProfile('Alex')
    service.processCommand(
      { gameCode: game.code, ...sessionA },
      {
        id: 'c1',
        command: { _tag: 'claim-seat', seatIndex: 0, profileId: profile.profileId },
      },
    )

    const finished = service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'f1', command: { _tag: 'finish-game' } },
    )
    expect(finished.status).toBe('ack')

    // The accepted command's durable transaction covers the archive too:
    // no active row remains, and the finished archive exists.
    expect(listActiveGames(db)).toHaveLength(0)
    const archived = getFinishedGame(db, game.gameId)
    expect(archived).not.toBeNull()
    expect(archived!.finalSnapshot.game.status).toBe('finished')

    // Cash-out finalization records the settlement row.
    const finalized = service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'f2', command: { _tag: 'finalize-cash-out', transfers: [] } },
    )
    expect(finalized.status).toBe('ack')
    const settlementRow = db
      .prepare('SELECT * FROM cash_settlements WHERE game_id = ?')
      .get(game.gameId)
    expect(settlementRow).toBeDefined()

    // A restarted service does not restore the finished game as active.
    const service2 = new GameService({
      db,
      clock: fixedClock,
      ids: sequentialIds(),
      codes: fixedCodes,
      broadcaster: spyBroadcaster(log, ref),
    })
    expect(service2.getSnapshot(game.gameId)).toBeNull()
  })

  it('accepts settlement from any connected player as an audited table action (Slice 9 verify)', () => {
    const log: BroadcastLog = { snapshotsSeenEvents: [], presence: 0 }
    const ref = { id: '' }
    const service = makeService(log, ref)
    const game = service.createGame({ creatorName: 'Host' })
    ref.id = game.gameId
    service.join({ gameCode: game.code, ...sessionA })
    service.join({ gameCode: game.code, ...sessionB })
    const p1 = service.createProfile('Alex')
    const p2 = service.createProfile('Sarah')

    const run = (session: typeof sessionA, id: string, command: unknown) =>
      service.processCommand({ gameCode: game.code, ...session }, { id, command })

    run(sessionA, 'c1', { _tag: 'claim-seat', seatIndex: 0, profileId: p1.profileId })
    run(sessionB, 'c2', { _tag: 'claim-seat', seatIndex: 1, profileId: p2.profileId })
    const players = [...service.getSnapshot(game.gameId)!.players].sort(
      (a, b) => a.seatIndex - b.seatIndex,
    )
    for (const [i, session] of [sessionA, sessionB].entries()) {
      run(session, `b${i}`, {
        _tag: 'record-buy-in',
        playerId: players[i]!.id,
        money: { currency: 'EUR', cents: 1000 },
        chips: 1000,
      })
    }
    run(sessionA, 'd', { _tag: 'set-dealer', seatIndex: 0 })
    run(sessionA, 's', { _tag: 'start-hand' })
    // Heads-up: dealer/SB (A) calls, BB (B) checks; check through every
    // street (BB acts first post-flop) to reach showdown.
    run(sessionA, 'a1', { _tag: 'call' })
    run(sessionB, 'a2', { _tag: 'check' })
    for (let street = 0; street < 3; street++) {
      run(sessionA, `ns${street}`, { _tag: 'confirm-next-street' })
      run(sessionB, `ck-b${street}`, { _tag: 'check' })
      run(sessionA, `ck-a${street}`, { _tag: 'check' })
    }
    run(sessionA, 'ns-final', { _tag: 'confirm-next-street' })
    const showdown = service.getSnapshot(game.gameId)!
    expect(showdown.game.status).toBe('showdown')

    // Session B — a connected player, not privileged in any way — settles.
    const winner = showdown.players.find((p) => p.seatIndex === 0)!
    const outcome = run(sessionB, 'settle', {
      _tag: 'take-all-eligible-pots',
      winnerId: winner.id,
    })
    expect(outcome.status).toBe('ack')
    expect(service.getSnapshot(game.gameId)!.game.status).toBe('between-hands')
  })

  it('restores active games from the database after a restart', () => {
    const log: BroadcastLog = { snapshotsSeenEvents: [], presence: 0 }
    const ref = { id: '' }
    const service = makeService(log, ref)
    const game = service.createGame({ creatorName: 'Alex' })
    ref.id = game.gameId
    service.join({ gameCode: game.code, ...sessionA })
    const p1 = service.createProfile('Alex')
    service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'c1', command: { _tag: 'claim-seat', seatIndex: 0, profileId: p1.profileId } },
    )
    const before = service.getSnapshot(game.gameId)!

    // Restart: a new service instance over the same database.
    const service2 = new GameService({
      db,
      clock: fixedClock,
      ids: sequentialIds(),
      codes: fixedCodes,
      broadcaster: spyBroadcaster(log, ref),
    })
    const restored = service2.getSnapshot(game.gameId)!
    expect(restored.players).toHaveLength(1)
    expect(restored.players[0]?.profileId).toBe(p1.profileId)
    // Live-connection state does not survive restart: seats come back
    // interrupted/reserved, never connected (ARCHITECTURE.md restoration).
    expect(restored.players[0]?.connection).not.toBe('connected')
    expect(restored.game.code).toBe(before.game.code)
  })
})
