// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { HistoryGame, ProfileStatsInfo } from '../api'
import { HistoryList } from './HistoryList'
import { ProfileStatsPanel } from './ProfileStatsPanel'

afterEach(cleanup)

const game: HistoryGame = {
  gameId: 'game_1',
  code: '48317',
  finishedAt: 1_780_000_000_000,
  handsPlayed: 12,
  finalized: true,
  settlement: {
    totalBuyInCents: 2000,
    transfers: [
      { fromProfileId: 'profile_b', toProfileId: 'profile_a', cents: 500 },
    ],
  },
  players: [
    {
      profileId: 'profile_a',
      name: 'Alex',
      buyInCents: 1000,
      cashOutCents: 1500,
      netCents: 500,
    },
    {
      profileId: 'profile_b',
      name: 'Sara',
      buyInCents: 1000,
      cashOutCents: 500,
      netCents: -500,
    },
  ],
}

describe('HistoryList', () => {
  it('lists finished games with hands, per-player nets, and settled badge', async () => {
    render(<HistoryList loadHistory={() => Promise.resolve([game])} />)
    await waitFor(() => expect(screen.getByText('#48317')).toBeTruthy())
    expect(screen.getByText(/12 hands/i)).toBeTruthy()
    expect(screen.getByText(/settled/i)).toBeTruthy()
    expect(screen.getByText('Alex').parentElement!.textContent).toContain('+5.00')
    expect(screen.getByText('Sara').parentElement!.textContent).toContain('-5.00')
  })

  it('says so when no games have finished yet', async () => {
    render(<HistoryList loadHistory={() => Promise.resolve([])} />)
    await waitFor(() => expect(screen.getByText(/no finished games/i)).toBeTruthy())
  })
})

const stats: ProfileStatsInfo = {
  profileId: 'profile_a',
  gamesPlayed: 2,
  totalBuyInCents: 2000,
  totalCashOutCents: 2200,
  totalNetCents: 200,
  biggestWinCents: 500,
  biggestLossCents: -300,
  averageNetCents: 100,
  totalHandsPlayed: 20,
  games: [
    {
      gameId: 'game_2',
      code: '48318',
      finishedAt: 2,
      handsPlayed: 8,
      buyInCents: 1000,
      cashOutCents: 700,
      netCents: -300,
    },
  ],
}

describe('ProfileStatsPanel', () => {
  it('loads and renders session stats for the selected profile', async () => {
    render(
      <ProfileStatsPanel
        profiles={[{ profileId: 'profile_a', name: 'Alex' }]}
        loadStats={() => Promise.resolve(stats)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /alex/i }))
    await waitFor(() => expect(screen.getByText(/games played/i)).toBeTruthy())

    const panel = screen.getByText(/games played/i).closest('.stats-panel')!
    expect(panel.textContent).toContain('2')
    expect(panel.textContent).toContain('+2.00')
    expect(panel.textContent).toContain('+5.00')
    expect(panel.textContent).toContain('-3.00')
    expect(panel.textContent).toContain('20')
  })
})
