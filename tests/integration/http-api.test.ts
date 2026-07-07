import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPokerServer, type PokerServer } from '../../src/server/app'
import { openDatabase, type AppDatabase } from '../../src/server/persistence/db'
import { migrate } from '../../src/server/persistence/migrations'

let dir: string
let db: AppDatabase
let server: PokerServer
let base: string

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'pcc-http-'))
  db = openDatabase(path.join(dir, 'test.db'))
  migrate(db)
  let n = 0
  server = createPokerServer({
    db,
    clock: { now: () => 1_780_000_000_000 },
    ids: { nextId: (prefix: string) => `${prefix}_${++n}` },
    codes: { nextCode: () => '48317' },
  })
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = server.httpServer.address()
  if (typeof address === 'object' && address) {
    base = `http://127.0.0.1:${address.port}`
  }
})

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.io.close(() => resolve())
  })
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('HTTP API', () => {
  it('creates and lists host-owned profiles', async () => {
    const created = await fetch(`${base}/api/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alex' }),
    })
    expect(created.status).toBe(201)
    const profile = await created.json()
    expect(profile.profileId).toBeTruthy()

    const list = await fetch(`${base}/api/profiles`)
    const { profiles } = await list.json()
    expect(profiles.map((p: { name: string }) => p.name)).toContain('Alex')
  })

  it('rejects empty profile names', async () => {
    const created = await fetch(`${base}/api/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })
    expect(created.status).toBe(400)
  })

  it('creates a game for an existing profile and records the creator', async () => {
    const profileRes = await fetch(`${base}/api/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Host' }),
    })
    const profile = await profileRes.json()

    const gameRes = await fetch(`${base}/api/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creatorProfileId: profile.profileId }),
    })
    expect(gameRes.status).toBe(201)
    const game = await gameRes.json()
    expect(game.code).toBe('48317')

    const snapshot = server.service.getSnapshot(game.gameId)!
    expect(snapshot.game.creatorProfileId).toBe(profile.profileId)
  })

  it('rejects game creation for unknown profiles', async () => {
    const gameRes = await fetch(`${base}/api/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creatorProfileId: 'profile_nope' }),
    })
    expect(gameRes.status).toBe(400)
  })

  it('reports LAN reachability info for the share screen', async () => {
    const res = await fetch(`${base}/api/server-info`)
    expect(res.status).toBe(200)
    const info = await res.json()
    expect(Array.isArray(info.addresses)).toBe(true)
    expect(typeof info.localhostOnly).toBe('boolean')
    expect(info.localhostOnly).toBe(info.addresses.length === 0)
  })

  it('serves the undo preview for the confirmation sheet (Slice 10)', async () => {
    const profileRes = await fetch(`${base}/api/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alex' }),
    })
    const profile = await profileRes.json()
    const gameRes = await fetch(`${base}/api/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creatorProfileId: profile.profileId }),
    })
    const game = await gameRes.json()

    // Only game-created exists: nothing is undoable yet.
    const empty = await fetch(`${base}/api/games/${game.code}/undo-preview`)
    expect(empty.status).toBe(404)

    // A seat claim becomes the latest visible transaction.
    server.service.join({ gameCode: game.code, sessionId: 's1', socketId: 'k1' })
    server.service.processCommand(
      { gameCode: game.code, sessionId: 's1', socketId: 'k1' },
      {
        id: 'c1',
        command: { _tag: 'claim-seat', seatIndex: 0, profileId: profile.profileId },
      },
    )
    const res = await fetch(`${base}/api/games/${game.code}/undo-preview`)
    expect(res.status).toBe(200)
    const preview = await res.json()
    expect(preview.transactionId).toBeTruthy()
    expect(preview.events).toContain('seat-claimed')
    expect(preview.undoable).toBe(true)

    const missing = await fetch(`${base}/api/games/99999/undo-preview`)
    expect(missing.status).toBe(404)
  })
})
