import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPokerServer, type PokerServer } from '../../src/server/app'
import { openDatabase, type AppDatabase } from '../../src/server/persistence/db'
import { migrate } from '../../src/server/persistence/migrations'

// Slice 11: the end-of-night read side — finished-game history, cash
// settlements, and session-level profile stats, all surviving a restart.

let dir: string
let db: AppDatabase
let server: PokerServer
let base: string

function makeServer(database: AppDatabase): PokerServer {
  let n = 0
  return createPokerServer({
    db: database,
    clock: { now: () => 1_780_000_000_000 + n * 7 },
    ids: { nextId: (prefix: string) => `${prefix}_${++n}` },
    codes: {
      nextCode: () => String(48000 + Math.floor(n / 2)),
    },
  })
}

async function listen(s: PokerServer): Promise<string> {
  await new Promise<void>((resolve) => {
    s.httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = s.httpServer.address()
  if (typeof address === 'object' && address) {
    return `http://127.0.0.1:${address.port}`
  }
  throw new Error('no address')
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'pcc-history-'))
  db = openDatabase(path.join(dir, 'test.db'))
  migrate(db)
  server = makeServer(db)
  base = await listen(server)
})

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.io.close(() => resolve())
  })
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const sessionA = { sessionId: 'sess-a', socketId: 'sock-a' }
const sessionB = { sessionId: 'sess-b', socketId: 'sock-b' }

/** Seat two profiles, buy both in, and finish the game from session B. */
function playAndFinish(options: { stacks?: [number, number] } = {}) {
  const service = server.service
  const game = service.createGame({ creatorName: 'Host' })
  const run = (session: typeof sessionA, id: string, command: unknown) =>
    service.processCommand({ gameCode: game.code, ...session }, { id, command })

  const profiles = [service.createProfile('Alex'), service.createProfile('Sara')]
  for (const [i, session] of [sessionA, sessionB].entries()) {
    service.join({ gameCode: game.code, ...session })
    run(session, `claim-${i}`, {
      _tag: 'claim-seat',
      seatIndex: i,
      profileId: profiles[i]!.profileId,
    })
  }
  const seated = service.getSnapshot(game.gameId)!
  for (const [i, session] of [sessionA, sessionB].entries()) {
    run(session, `buyin-${i}`, {
      _tag: 'record-buy-in',
      playerId: seated.players.find((p) => p.seatIndex === i)!.id,
      money: { currency: 'EUR', cents: 1000 },
      chips: 1000,
    })
  }
  if (options.stacks) {
    // Zero-sum correction moves chips so the finished game has winners.
    const players = service.getSnapshot(game.gameId)!.players
    const p0 = players.find((p) => p.seatIndex === 0)!
    const delta = options.stacks[0] - p0.stack
    if (delta !== 0) {
      run(sessionA, 'skew', {
        _tag: 'apply-correction',
        reason: 'test stacks',
        moves: [
          { target: { kind: 'player-stack', playerId: players[0]!.id }, delta },
          { target: { kind: 'player-stack', playerId: players[1]!.id }, delta: -delta },
        ],
      })
    }
  }
  // Any connected player can finish, not just the creator (SPEC.md).
  const outcome = run(sessionB, 'finish', { _tag: 'finish-game' })
  expect(outcome.status).toBe('ack')
  return { game, profiles }
}

describe('finished-game history', () => {
  it('lists a finished game with per-player nets and settlement', async () => {
    const { game, profiles } = playAndFinish({ stacks: [1500, 500] })

    const res = await fetch(`${base}/api/history`)
    expect(res.status).toBe(200)
    const { games } = await res.json()
    expect(games).toHaveLength(1)
    const entry = games[0]
    expect(entry.gameId).toBe(game.gameId)
    expect(entry.code).toBe(game.code)
    expect(entry.finalized).toBe(false)
    expect(entry.settlement.totalBuyInCents).toBe(2000)

    const alex = entry.players.find(
      (p: { profileId: string }) => p.profileId === profiles[0]!.profileId,
    )
    expect(alex).toMatchObject({
      name: 'Alex',
      buyInCents: 1000,
      cashOutCents: 1500,
      netCents: 500,
    })
  })

  it('marks the game finalized and serves the recorded transfers', async () => {
    const { game, profiles } = playAndFinish({ stacks: [1500, 500] })
    const transfers = [
      {
        fromProfileId: profiles[1]!.profileId,
        toProfileId: profiles[0]!.profileId,
        cents: 500,
      },
    ]
    const outcome = server.service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'fin', command: { _tag: 'finalize-cash-out', transfers } },
    )
    expect(outcome.status).toBe('ack')

    const settlementRes = await fetch(`${base}/api/games/${game.code}/settlement`)
    expect(settlementRes.status).toBe(200)
    const settlement = await settlementRes.json()
    expect(settlement.transfers).toEqual(transfers)

    const { games } = await (await fetch(`${base}/api/history`)).json()
    expect(games[0].finalized).toBe(true)
  })

  it('history surfaces the FINALIZED transfers once edited, not the suggestion (PR #183 review)', async () => {
    const { game, profiles } = playAndFinish({ stacks: [1500, 500] })
    // Suggested at finish time: 500 cents. The table agrees on 350.
    const edited = [
      {
        fromProfileId: profiles[1]!.profileId,
        toProfileId: profiles[0]!.profileId,
        cents: 350,
      },
    ]
    server.service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'fin', command: { _tag: 'finalize-cash-out', transfers: edited } },
    )

    const { games } = await (await fetch(`${base}/api/history`)).json()
    expect(games[0].finalized).toBe(true)
    expect(games[0].settlement.transfers).toEqual(edited)
    // The buy-in total still comes from the archive.
    expect(games[0].settlement.totalBuyInCents).toBe(2000)
  })

  it('returns 404 for a settlement that has not been finalized', async () => {
    const { game } = playAndFinish()
    const res = await fetch(`${base}/api/games/${game.code}/settlement`)
    expect(res.status).toBe(404)
  })

  it('survives a server restart: history and stats read from SQLite', async () => {
    playAndFinish({ stacks: [1500, 500] })
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve())
    })

    server = makeServer(db)
    base = await listen(server)
    const { games } = await (await fetch(`${base}/api/history`)).json()
    expect(games).toHaveLength(1)
    expect(games[0].settlement.totalBuyInCents).toBe(2000)
  })
})

describe('finish and finalize are terminal (verification F1/F2)', () => {
  it('refuses to undo game-finished: the archive cannot be restored by snapshot undo', () => {
    const { game } = playAndFinish({ stacks: [1500, 500] })

    const preview = server.service.undoPreview(game.gameId)!
    expect(preview.events).toContain('game-finished')
    expect(preview.undoable).toBe(false)

    const outcome = server.service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'undo-finish', command: { _tag: 'undo' } },
    )
    expect(outcome.status).toBe('rejected')
    // The finished state is intact: no half-live game with a stale archive
    // row, and no path to the finished_games UNIQUE crash on re-finish.
    expect(server.service.getSnapshot(game.gameId)!.game.status).toBe('finished')
  })

  it('refuses to undo cash-out-finalized and rejects a second finalize', async () => {
    const { game, profiles } = playAndFinish({ stacks: [1500, 500] })
    const transfers = [
      {
        fromProfileId: profiles[1]!.profileId,
        toProfileId: profiles[0]!.profileId,
        cents: 500,
      },
    ]
    const run = (id: string, command: unknown) =>
      server.service.processCommand(
        { gameCode: game.code, ...sessionA },
        { id, command },
      )
    expect(run('fin', { _tag: 'finalize-cash-out', transfers }).status).toBe('ack')

    expect(server.service.undoPreview(game.gameId)!.undoable).toBe(false)
    expect(run('undo-fin', { _tag: 'undo' }).status).toBe('rejected')

    // A stale phone must not silently overwrite the recorded settlement.
    const second = run('fin-2', {
      _tag: 'finalize-cash-out',
      transfers: [{ ...transfers[0]!, cents: 123 }],
    })
    expect(second.status).toBe('rejected')
    if (second.status === 'rejected') {
      expect(second.reason).toContain('already finalized')
    }
    const settlement = await (
      await fetch(`${base}/api/games/${game.code}/settlement`)
    ).json()
    expect(settlement.transfers[0].cents).toBe(500)
  })

  it('serves the settlement after a restart via the archive fallback (verification F3)', async () => {
    const { game, profiles } = playAndFinish({ stacks: [1500, 500] })
    const transfers = [
      {
        fromProfileId: profiles[1]!.profileId,
        toProfileId: profiles[0]!.profileId,
        cents: 500,
      },
    ]
    server.service.processCommand(
      { gameCode: game.code, ...sessionA },
      { id: 'fin', command: { _tag: 'finalize-cash-out', transfers } },
    )
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve())
    })

    server = makeServer(db)
    base = await listen(server)
    // The finished game is gone from the runtime code map...
    expect(server.service.findGameByCode(game.code)).toBeNull()
    // ...but the settlement still resolves through the archive.
    const res = await fetch(`${base}/api/games/${game.code}/settlement`)
    expect(res.status).toBe(200)
    expect((await res.json()).transfers).toEqual(transfers)
  })
})

describe('profile stats', () => {
  it('aggregates session stats across finished games', async () => {
    const first = playAndFinish({ stacks: [1500, 500] })
    const second = playAndFinish({ stacks: [700, 1300] })
    expect(second.profiles[0]!.profileId).not.toBe(first.profiles[0]!.profileId)

    // Both games used fresh profiles; query the first game's winner.
    const res = await fetch(
      `${base}/api/profiles/${first.profiles[0]!.profileId}/stats`,
    )
    expect(res.status).toBe(200)
    const stats = await res.json()
    expect(stats.profileId).toBe(first.profiles[0]!.profileId)
    expect(stats.gamesPlayed).toBe(1)
    expect(stats.totalNetCents).toBe(500)
    expect(stats.biggestWinCents).toBe(500)
    expect(stats.totalHandsPlayed).toBe(0)
    expect(stats.games).toHaveLength(1)
  })

  it('returns zeroed stats for an unknown profile', async () => {
    const res = await fetch(`${base}/api/profiles/profile_ghost/stats`)
    expect(res.status).toBe(200)
    const stats = await res.json()
    expect(stats.gamesPlayed).toBe(0)
    expect(stats.games).toEqual([])
  })
})
