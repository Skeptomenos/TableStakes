// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeBetweenHandsSnapshot, makeTestSettings } from '../../domain/state/fixtures'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { CashOutScreen, type FinalizedSettlement } from './CashOutScreen'

afterEach(cleanup)

// Fixture: 2 players, 1000 cents buy-in each. Seat 0 (Player 1) ends with
// 1500 chips: cash-out 15.00, net +5.00; Player 2 mirrors at -5.00.

function winnersSnapshot(): GameSnapshot {
  const base = makeBetweenHandsSnapshot({
    playerCount: 2,
    playerOverrides: { 0: { stack: 1500 }, 1: { stack: 500 } },
  })
  return { ...base, game: { ...base.game, status: 'finished' } }
}

function renderScreen(
  snapshot: GameSnapshot,
  settlement: FinalizedSettlement | null = null,
  options: { accept?: boolean } = {},
) {
  // The server is the source of truth for "settled": once a finalize is
  // ACCEPTED, the settlement endpoint starts returning the record.
  const state = { settlement }
  const accept = options.accept ?? true
  const onCommand = vi.fn((command: unknown) => {
    const tagged = command as { _tag: string; transfers?: FinalizedSettlement['transfers'] }
    if (accept && tagged._tag === 'finalize-cash-out') {
      state.settlement = { finalizedAt: 1, transfers: tagged.transfers ?? [] }
    }
    return Promise.resolve(accept)
  })
  render(
    <CashOutScreen
      snapshot={snapshot}
      onCommand={onCommand}
      loadSettlement={() => Promise.resolve(state.settlement)}
    />,
  )
  return onCommand
}

describe('accounting rows', () => {
  it('shows buy-in, final chips, cash-out value, and net per player', async () => {
    renderScreen(winnersSnapshot())
    await waitFor(() => expect(screen.getByText('Player 1')).toBeTruthy())

    const row = screen.getByText('Player 1').closest('.cash-out__row')!
    expect(row.textContent).toContain('10.00')
    expect(row.textContent).toContain('1500')
    expect(row.textContent).toContain('15.00')
    expect(row.textContent).toContain('+5.00')

    const loser = screen.getByText('Player 2').closest('.cash-out__row')!
    expect(loser.textContent).toContain('-5.00')
    // Conservation summary: total cash-out equals total buy-ins.
    expect(screen.getByText(/total buy-ins/i).parentElement!.textContent).toContain(
      '20.00',
    )
  })

  it('calls out the rounding remainder when shares cannot split evenly', async () => {
    const base = makeBetweenHandsSnapshot({
      playerCount: 2,
      settings: makeTestSettings({ defaultStack: 300 }),
      playerOverrides: {
        0: { stack: 301, totalChipsPurchased: 300 },
        1: { stack: 299, totalChipsPurchased: 300 },
      },
    })
    renderScreen({ ...base, game: { ...base.game, status: 'finished' } })
    await waitFor(() => expect(screen.getByText(/rounding/i)).toBeTruthy())
  })
})

describe('editable transfers and finalization', () => {
  it('prefills suggested transfers and finalizes edited amounts after confirmation', async () => {
    const onCommand = renderScreen(winnersSnapshot())
    await waitFor(() => expect(screen.getByLabelText(/transfer amount/i)).toBeTruthy())

    // Suggested: Player 2 pays Player 1 500 cents. The table agrees on 450.
    fireEvent.change(screen.getByLabelText(/transfer amount/i), {
      target: { value: '450' },
    })
    fireEvent.click(screen.getByRole('button', { name: /finalize cash-out/i }))
    expect(onCommand).not.toHaveBeenCalled()
    // Confirmation copy states the settlement impact (SPEC.md).
    expect(screen.getByRole('dialog').textContent).toMatch(/1 transfer/i)
    expect(screen.getByRole('dialog').textContent).toContain('4.50')

    fireEvent.click(screen.getByRole('button', { name: /confirm cash-out/i }))
    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'finalize-cash-out',
      transfers: [
        {
          fromProfileId: 'profile_s1',
          toProfileId: 'profile_s0',
          cents: 450,
        },
      ],
    })
    // Settled appears only after the server accepted and the settlement
    // reloaded — never optimistically (PR #183 review).
    await waitFor(() => expect(screen.getByText(/settled/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /finalize cash-out/i })).toBeNull()
  })

  it('a rejected finalize never fakes a settled state (PR #183 review)', async () => {
    const onCommand = renderScreen(winnersSnapshot(), null, { accept: false })
    await waitFor(() => expect(screen.getByLabelText(/transfer amount/i)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /finalize cash-out/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm cash-out/i }))
    expect(onCommand).toHaveBeenCalled()

    // The screen stays editable: no false Settled, the button remains.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /finalize cash-out/i })).toBeTruthy(),
    )
    expect(screen.queryByText(/settled/i)).toBeNull()
    expect(screen.getByLabelText(/transfer amount/i)).toBeTruthy()
  })

  it('can remove a transfer and restore the suggestions', async () => {
    renderScreen(winnersSnapshot())
    await waitFor(() => expect(screen.getByLabelText(/transfer amount/i)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /remove transfer/i }))
    expect(screen.queryByLabelText(/transfer amount/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /reset to suggested/i }))
    expect(screen.getByLabelText(/transfer amount/i)).toBeTruthy()
  })

  it('renders read-only once a settlement was finalized', async () => {
    renderScreen(winnersSnapshot(), {
      finalizedAt: 1_780_000_000_000,
      transfers: [
        { fromProfileId: 'profile_s1', toProfileId: 'profile_s0', cents: 500 },
      ],
    })
    await waitFor(() => expect(screen.getByText(/settled/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /finalize cash-out/i })).toBeNull()
    expect(screen.queryByLabelText(/transfer amount/i)).toBeNull()
    expect(
      screen.getByText(/player 2 pays player 1/i).parentElement!.textContent,
    ).toContain('5.00 EUR')
  })

  it('flips to Settled when another phone finalizes (broadcast snapshot)', async () => {
    // Slice 12: the screen re-reads the settlement when the broadcast
    // snapshot carries a new eventCursor — a phone parked on cash-out must
    // not stay editable after the table settles elsewhere (its own stale
    // finalize is server-rejected, but the view should follow the table).
    const state: { settlement: FinalizedSettlement | null } = { settlement: null }
    const snapshot = winnersSnapshot()
    const { rerender } = render(
      <CashOutScreen
        snapshot={snapshot}
        onCommand={() => Promise.resolve(true)}
        loadSettlement={() => Promise.resolve(state.settlement)}
      />,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /finalize cash-out/i })).toBeTruthy(),
    )

    // Another phone finalizes: the server records the settlement and
    // broadcasts a snapshot with an advanced event cursor.
    state.settlement = {
      finalizedAt: 2,
      transfers: [
        { fromProfileId: 'profile_s1', toProfileId: 'profile_s0', cents: 500 },
      ],
    }
    rerender(
      <CashOutScreen
        snapshot={{ ...snapshot, eventCursor: snapshot.eventCursor + 1 }}
        onCommand={() => Promise.resolve(true)}
        loadSettlement={() => Promise.resolve(state.settlement)}
      />,
    )

    await waitFor(() => expect(screen.getByText(/settled/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /finalize cash-out/i })).toBeNull()
  })
})
