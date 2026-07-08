// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeSetupSnapshot, makeTestPlayer } from '../../domain/state/fixtures'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { GameRoute } from './GameRoute'

// ADR 0002: a claimed seat with stack === 0 must show the buy-in
// confirmation and send record-buy-in with EXACTLY the snapshot defaults —
// never an amount the player could vary.

type SnapshotListener = (snapshot: GameSnapshot) => void

let listeners: SnapshotListener[] = []
const sendCommand = vi.fn(() => Promise.resolve())

vi.mock('../socket-client', () => ({
  connectToGame: () => ({
    socket: {},
    onSnapshot: (listener: SnapshotListener) => {
      listeners.push(listener)
    },
    onJoinError: () => {},
    sendCommand,
    disconnect: () => {},
  }),
}))

vi.mock('../api', () => ({
  getProfiles: () => Promise.resolve([]),
  getServerInfo: () => Promise.resolve({ addresses: [] }),
  getSettlement: () => Promise.resolve(null),
  createProfile: () => Promise.reject(new Error('not in this test')),
  getUndoPreview: () => Promise.resolve(null),
}))

vi.mock('../session', () => ({
  recallProfile: () => 'profile_s0',
  rememberProfile: () => {},
  sessionId: () => 'session_1',
}))

function emptySeatSnapshot(): GameSnapshot {
  return makeSetupSnapshot({ playerCount: 0 })
}

function noChipsSeatedSnapshot(): GameSnapshot {
  const base = makeSetupSnapshot({ playerCount: 0 })
  return {
    ...base,
    players: [
      makeTestPlayer(0, {
        stack: 0,
        totalChipsPurchased: 0,
        totalBuyInCents: 0,
        handStatus: 'needs-rebuy',
      }),
    ],
  }
}

afterEach(cleanup)
beforeEach(() => {
  listeners = []
  sendCommand.mockClear()
})

describe('GameRoute buy-in confirmation phase', () => {
  it('shows BuyInConfirm after claiming an empty seat, and confirming sends the exact defaults', async () => {
    render(<GameRoute code="48317" />)

    // Empty table: profile already recalled (mocked), seat list shown.
    await act(async () => {
      listeners.forEach((l) => l(emptySeatSnapshot()))
    })
    expect(screen.getByText('Claim a seat')).toBeTruthy()

    // Claim seat 1 (index 0) — the client optimistically tracks mySeat on
    // ack, then the server's next snapshot shows the claimed-but-chipless
    // seat.
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Claim Seat' })[0]!)
    })
    await act(async () => {
      listeners.forEach((l) => l(noChipsSeatedSnapshot()))
    })

    expect(screen.getByText('Confirm your buy-in')).toBeTruthy()
    expect(screen.getByText('10 EUR = 1000 chips')).toBeTruthy()

    sendCommand.mockClear()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /buy in for 10 eur/i }),
      )
    })

    expect(sendCommand).toHaveBeenCalledWith({
      _tag: 'record-buy-in',
      playerId: 'player_s0',
      money: { currency: 'EUR', cents: 1000 },
      chips: 1000,
    })
  })

  it('skips BuyInConfirm when reclaiming a seat that already has chips', async () => {
    render(<GameRoute code="48317" />)

    await act(async () => {
      listeners.forEach((l) => l(emptySeatSnapshot()))
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Claim Seat' })[0]!)
    })

    const base = makeSetupSnapshot({ playerCount: 0 })
    const withChips: GameSnapshot = {
      ...base,
      players: [makeTestPlayer(0, { stack: 1000 })],
    }
    await act(async () => {
      listeners.forEach((l) => l(withChips))
    })

    expect(screen.queryByText('Confirm your buy-in')).toBeNull()
    expect(screen.getByText('Table is set')).toBeTruthy()
  })
})
