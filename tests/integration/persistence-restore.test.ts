import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeSetupSnapshot } from '../../src/domain/state/fixtures'
import { openDatabase, type AppDatabase } from '../../src/server/persistence/db'
import {
  appendEvents,
  listEventsAfter,
} from '../../src/server/persistence/event-store'
import {
  archiveFinishedGame,
  getFinishedGame,
  listFinishedGames,
} from '../../src/server/persistence/finished-game-store'
import {
  createGameWithUniqueCode,
  getGameByCode,
  listActiveGames,
} from '../../src/server/persistence/game-store'
import { migrate } from '../../src/server/persistence/migrations'
import {
  createProfile,
  listProfiles,
} from '../../src/server/persistence/profile-store'
import {
  latestSnapshot,
  saveSnapshot,
} from '../../src/server/persistence/snapshot-store'
import type { EventEnvelope } from '../../src/shared/schema/events'

let dir: string
let dbPath: string
let db: AppDatabase

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pcc-test-'))
  dbPath = path.join(dir, 'test.db')
  db = openDatabase(dbPath)
  migrate(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function envelope(
  id: string,
  gameId: string,
  overrides: Partial<Record<string, unknown>> = {},
): EventEnvelope {
  return {
    id,
    gameId,
    handId: null,
    visibleTransactionId: `vtx_${id}`,
    actorProfileId: 'profile_s0',
    timestamp: 1_780_000_000_000,
    event: { _tag: 'checked', seatIndex: 1 },
    ...overrides,
  } as EventEnvelope
}

const sequentialCodes = (...codes: string[]) => {
  let i = 0
  return () => codes[Math.min(i++, codes.length - 1)]!
}

describe('migrations', () => {
  it('bootstraps every required table', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name)
    for (const table of [
      'games',
      'game_codes',
      'player_profiles',
      'game_players',
      'events',
      'snapshots',
      'visible_transactions',
      'finished_games',
      'cash_settlements',
    ]) {
      expect(names, `missing table ${table}`).toContain(table)
    }
  })

  it('is idempotent and stamps user_version', () => {
    // user_version is the migration cursor: a re-run must be a no-op that
    // leaves the version at the migration count (Slice 12 hardening).
    const version = db.pragma('user_version', { simple: true }) as number
    expect(version).toBeGreaterThan(0)
    const rerun = migrate(db)
    expect(rerun.from).toBe(version)
    expect(rerun.to).toBe(version)
    expect(db.pragma('user_version', { simple: true })).toBe(version)
  })
})

describe('game creation and code uniqueness', () => {
  it('creates a game with a unique five-digit code', () => {
    const game = createGameWithUniqueCode(db, {
      gameId: 'game_1',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('48317'),
    })
    expect(game.code).toBe('48317')
    expect(getGameByCode(db, '48317')?.gameId).toBe('game_1')
    expect(listActiveGames(db).map((g) => g.gameId)).toEqual(['game_1'])
  })

  it('regenerates on collision', () => {
    createGameWithUniqueCode(db, {
      gameId: 'game_1',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('11111'),
    })
    const second = createGameWithUniqueCode(db, {
      gameId: 'game_2',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('11111', '11111', '22222'),
    })
    expect(second.code).toBe('22222')
  })

  it('does not swallow non-collision constraint failures as collisions', () => {
    // Same code AND same game id: the code insert collides first, the
    // retry then hits the games PRIMARY KEY. Only game_codes uniqueness
    // may be treated as a collision; anything else must surface
    // (Slice 12: match by error code + constraint, not message-only).
    createGameWithUniqueCode(db, {
      gameId: 'game_dup',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('11111'),
    })
    expect(() =>
      createGameWithUniqueCode(db, {
        gameId: 'game_dup',
        creatorProfileId: 'profile_s0',
        generateCode: sequentialCodes('11111', '33333'),
      }),
    ).toThrow(/games/)
  })

  it('fails with a clear error when collision attempts are exhausted', () => {
    createGameWithUniqueCode(db, {
      gameId: 'game_1',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('11111'),
    })
    expect(() =>
      createGameWithUniqueCode(db, {
        gameId: 'game_2',
        creatorProfileId: 'profile_s0',
        generateCode: sequentialCodes('11111'),
        maxAttempts: 3,
      }),
    ).toThrow(/collision/i)
  })
})

describe('event store', () => {
  it('appends events in order and reads them back after a given sequence', () => {
    createGameWithUniqueCode(db, {
      gameId: 'game_1',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('48317'),
    })
    appendEvents(db, [envelope('evt_1', 'game_1'), envelope('evt_2', 'game_1')])
    appendEvents(db, [envelope('evt_3', 'game_1')])

    const all = listEventsAfter(db, 'game_1', 0)
    expect(all.map((e) => e.envelope.id)).toEqual(['evt_1', 'evt_2', 'evt_3'])
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3])

    const after = listEventsAfter(db, 'game_1', 2)
    expect(after.map((e) => e.envelope.id)).toEqual(['evt_3'])
  })

  it('rolls the whole batch back when one event conflicts', () => {
    createGameWithUniqueCode(db, {
      gameId: 'game_1',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('48317'),
    })
    appendEvents(db, [envelope('evt_1', 'game_1')])
    expect(() =>
      appendEvents(db, [envelope('evt_2', 'game_1'), envelope('evt_1', 'game_1')]),
    ).toThrow()
    expect(listEventsAfter(db, 'game_1', 0)).toHaveLength(1)
  })
})

describe('snapshot store and restart restore', () => {
  it('restores an active game from a real reopened database file', () => {
    createGameWithUniqueCode(db, {
      gameId: 'game_test',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('48317'),
    })
    const snapshot = makeSetupSnapshot({ playerCount: 3 })
    appendEvents(db, [envelope('evt_1', 'game_test'), envelope('evt_2', 'game_test')])
    saveSnapshot(db, 'game_test', 2, snapshot)
    appendEvents(db, [envelope('evt_3', 'game_test')])
    db.close()

    // Restart: reopen the same file.
    db = openDatabase(dbPath)
    migrate(db)
    const restored = latestSnapshot(db, 'game_test')
    expect(restored).not.toBeNull()
    expect(restored!.eventSeq).toBe(2)
    expect(restored!.snapshot).toEqual(snapshot)

    const later = listEventsAfter(db, 'game_test', restored!.eventSeq)
    expect(later.map((e) => e.envelope.id)).toEqual(['evt_3'])
    expect(listActiveGames(db).map((g) => g.gameId)).toEqual(['game_test'])
  })

  it('rejects snapshots that fail schema validation on read', () => {
    createGameWithUniqueCode(db, {
      gameId: 'game_1',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('48317'),
    })
    db.prepare(
      'INSERT INTO snapshots (game_id, event_seq, payload) VALUES (?, ?, ?)',
    ).run('game_1', 1, JSON.stringify({ not: 'a snapshot' }))
    expect(() => latestSnapshot(db, 'game_1')).toThrow()
  })
})

describe('profiles', () => {
  it('creates and lists host-owned profiles', () => {
    createProfile(db, { profileId: 'profile_a', name: 'Alex' })
    createProfile(db, { profileId: 'profile_b', name: 'Sarah' })
    expect(listProfiles(db).map((p) => p.name)).toEqual(['Alex', 'Sarah'])
  })
})

describe('finished games', () => {
  it('archives a finished game with final snapshot and settlement summary', () => {
    createGameWithUniqueCode(db, {
      gameId: 'game_1',
      creatorProfileId: 'profile_s0',
      generateCode: sequentialCodes('48317'),
    })
    const snapshot = makeSetupSnapshot({ playerCount: 2 })
    archiveFinishedGame(db, {
      gameId: 'game_1',
      finishedAt: 1_780_000_000_000,
      finalSnapshot: snapshot,
      settlement: {
        totalBuyInCents: 2000,
        transfers: [
          { fromProfileId: 'profile_s1', toProfileId: 'profile_s0', cents: 500 },
        ],
      },
    })

    // Finished games leave the active list but stay queryable.
    expect(listActiveGames(db)).toHaveLength(0)
    expect(listFinishedGames(db).map((g) => g.gameId)).toEqual(['game_1'])
    const finished = getFinishedGame(db, 'game_1')
    expect(finished?.finalSnapshot).toEqual(snapshot)
    expect(finished?.settlement.totalBuyInCents).toBe(2000)
  })
})
