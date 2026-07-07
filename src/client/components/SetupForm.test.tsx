// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeSetupSnapshot, makeTestPlayer } from '../../domain/state/fixtures'
import { SetupForm } from './SetupForm'

afterEach(cleanup)

function seatedSnapshot() {
  const base = makeSetupSnapshot({ playerCount: 0 })
  return {
    ...base,
    game: { ...base.game, dealerSeat: null },
    players: [makeTestPlayer(0), makeTestPlayer(1), makeTestPlayer(2)],
  }
}

describe('SetupForm', () => {
  it('shows every required field with strict mode off by default', () => {
    render(<SetupForm snapshot={seatedSnapshot()} onStart={() => {}} />)

    expect(screen.getByLabelText(/currency/i)).toBeTruthy()
    expect(screen.getByLabelText(/buy-in/i)).toBeTruthy()
    expect(screen.getByLabelText(/stack/i)).toBeTruthy()
    expect(screen.getByLabelText(/small blind/i)).toBeTruthy()
    expect(screen.getByLabelText(/big blind/i)).toBeTruthy()

    const strict = screen.getByLabelText(/strict mode/i) as HTMLInputElement
    expect(strict.checked).toBe(false)
  })

  it('shows the money-to-chip relationship and keeps it live', () => {
    render(<SetupForm snapshot={seatedSnapshot()} onStart={() => {}} />)
    expect(screen.getByText('10 EUR = 1000 chips')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/stack/i), {
      target: { value: '2000' },
    })
    expect(screen.getByText('10 EUR = 2000 chips')).toBeTruthy()
  })

  it('selects exactly one dealer', () => {
    render(<SetupForm snapshot={seatedSnapshot()} onStart={() => {}} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios).toHaveLength(3)

    fireEvent.click(radios[1]!)
    expect(radios.filter((r) => r.checked)).toHaveLength(1)
    fireEvent.click(radios[2]!)
    expect(radios[1]!.checked).toBe(false)
    expect(radios[2]!.checked).toBe(true)
  })

  it('submits settings and the selected dealer', () => {
    const onStart = vi.fn()
    render(<SetupForm snapshot={seatedSnapshot()} onStart={onStart} />)
    fireEvent.click(screen.getAllByRole('radio')[0]!)
    fireEvent.click(screen.getByRole('button', { name: /start game/i }))

    expect(onStart).toHaveBeenCalledTimes(1)
    const payload = onStart.mock.calls[0]![0]
    expect(payload.dealerSeat).toBe(0)
    expect(payload.settings.strictMode).toBe(false)
    expect(payload.settings.defaultBuyInCents).toBe(1000)
    expect(payload.settings.defaultStack).toBe(1000)
  })
})
