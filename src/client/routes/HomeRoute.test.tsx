// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HomeRoute } from './HomeRoute'

// ADR 0002: the player landing is select-only — picking a profile writes a
// reconnect hint and nothing else. No player surface can create a table
// (SPEC.md), so there is no createGame import here at all to accidentally
// wire up.

const rememberLastProfile = vi.fn()

vi.mock('../api', () => ({
  getProfiles: () =>
    Promise.resolve([{ profileId: 'profile_a', name: 'Alex' }]),
  listGames: () =>
    Promise.resolve([
      { code: '48317', status: 'setup', seatedCount: 1, createdAt: 1 },
    ]),
  getHistory: () => Promise.resolve([]),
  getProfileStats: () => Promise.resolve(null),
  createProfile: () => Promise.reject(new Error('not in this test')),
}))

vi.mock('../session', () => ({
  rememberLastProfile: (...args: unknown[]) => rememberLastProfile(...args),
}))

const navigate = vi.fn()
vi.mock('../router', () => ({
  navigate: (...args: unknown[]) => navigate(...args),
}))

afterEach(cleanup)
beforeEach(() => {
  rememberLastProfile.mockClear()
  navigate.mockClear()
})

describe('HomeRoute (player landing)', () => {
  it('selecting a profile only remembers it — no navigation, no game creation', async () => {
    render(<HomeRoute />)
    await waitFor(() => screen.getByText('Alex (Local)'))

    await act(async () => {
      fireEvent.click(screen.getByText('Alex (Local)'))
    })

    expect(rememberLastProfile).toHaveBeenCalledWith('profile_a')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('lists active tables and tapping one navigates to /g/<code>', async () => {
    render(<HomeRoute />)
    await waitFor(() => screen.getByText('#48317'))
    expect(screen.getByText('1 seated')).toBeTruthy()

    fireEvent.click(screen.getByText('#48317'))
    expect(navigate).toHaveBeenCalledWith('/g/48317')
  })

  it('has no table-creation affordance anywhere on the landing', async () => {
    render(<HomeRoute />)
    await waitFor(() => screen.getByText('Alex (Local)'))
    expect(screen.queryByText(/create table/i)).toBeNull()
    expect(screen.queryByText(/start a table/i)).toBeNull()
  })
})
