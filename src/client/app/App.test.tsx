// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeSetupSnapshot } from '../../domain/state/fixtures'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { navigate } from '../router'
import { App } from './App'

// GameRoute keying (post-verification F7): navigating from one game code
// to another must REMOUNT the route — state from the previous game
// (snapshot, claimed seat, profile) may never bleed into the next.

type SnapshotListener = (snapshot: GameSnapshot) => void

const connections: { code: string; listeners: SnapshotListener[] }[] = []

vi.mock('../socket-client', () => ({
  connectToGame: (code: string) => {
    const connection = { code, listeners: [] as SnapshotListener[] }
    connections.push(connection)
    return {
      socket: {},
      onSnapshot: (listener: SnapshotListener) => {
        connection.listeners.push(listener)
      },
      onJoinError: () => {},
      sendCommand: () => Promise.resolve(),
      disconnect: () => {},
    }
  },
}))

vi.mock('../api', () => ({
  getProfiles: () => Promise.resolve([]),
  getServerInfo: () => Promise.resolve({ addresses: [] }),
  getSettlement: () => Promise.resolve(null),
  getHistory: () => Promise.resolve([]),
  getProfileStats: () => Promise.resolve(null),
  createProfile: () => Promise.reject(new Error('not in this test')),
  createGame: () => Promise.reject(new Error('not in this test')),
  getUndoPreview: () => Promise.resolve(null),
}))

function snapshotFor(code: string): GameSnapshot {
  const base = makeSetupSnapshot({ playerCount: 2 })
  return { ...base, game: { ...base.game, code } } as GameSnapshot
}

afterEach(cleanup)
beforeEach(() => {
  connections.length = 0
})

describe('App game-route keying', () => {
  it('remounts GameRoute when the code changes: no stale snapshot (F7)', async () => {
    window.history.pushState(null, '', '/g/11111')
    render(<App />)

    // Game 11111's snapshot arrives: the join flow renders.
    await act(async () => {
      connections[0]!.listeners.forEach((l) => l(snapshotFor('11111')))
    })
    expect(screen.getByText('Join Local Game')).toBeTruthy()

    // Navigate straight to another code. The route must remount: fresh
    // connection for 22222 AND the connecting placeholder — never game
    // 11111's stale snapshot.
    await act(async () => {
      navigate('/g/22222')
    })
    expect(connections.map((c) => c.code)).toEqual(['11111', '22222'])
    expect(screen.getByText(/Connecting to table 22222/)).toBeTruthy()
    expect(screen.queryByText('Join Local Game')).toBeNull()
  })
})
