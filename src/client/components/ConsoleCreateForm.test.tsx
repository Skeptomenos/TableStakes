// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleCreateForm } from './ConsoleCreateForm'

afterEach(cleanup)

// ADR 0002: table settings move to the console, no dealer pick or buy-ins
// here (both moved to their own console/phone phases) — ported from the
// retired SetupForm's field-coverage and ratio-line tests.
describe('ConsoleCreateForm', () => {
  it('shows every required field with strict mode off by default', () => {
    render(<ConsoleCreateForm onCreate={() => {}} />)

    expect(screen.getByLabelText(/currency/i)).toBeTruthy()
    expect(screen.getByLabelText(/buy-in/i)).toBeTruthy()
    expect(screen.getByLabelText(/stack/i)).toBeTruthy()
    expect(screen.getByLabelText(/small blind/i)).toBeTruthy()
    expect(screen.getByLabelText(/big blind/i)).toBeTruthy()

    const strict = screen.getByLabelText(/strict mode/i) as HTMLInputElement
    expect(strict.checked).toBe(false)
  })

  it('shows the money-to-chip relationship and keeps it live', () => {
    render(<ConsoleCreateForm onCreate={() => {}} />)
    expect(screen.getByText('10 EUR = 1000 chips')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/stack/i), {
      target: { value: '2000' },
    })
    expect(screen.getByText('10 EUR = 2000 chips')).toBeTruthy()
  })

  it('has no dealer selection — dealer pick moved to its own console phase', () => {
    render(<ConsoleCreateForm onCreate={() => {}} />)
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('submits settings only (no dealer, no buy-ins)', () => {
    const onCreate = vi.fn()
    render(<ConsoleCreateForm onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: /create table/i }))

    expect(onCreate).toHaveBeenCalledTimes(1)
    const settings = onCreate.mock.calls[0]![0]
    expect(settings.strictMode).toBe(false)
    expect(settings.defaultBuyInCents).toBe(1000)
    expect(settings.defaultStack).toBe(1000)
    expect(settings.currency).toBe('EUR')
    expect(settings.smallBlind).toBe(50)
    expect(settings.bigBlind).toBe(100)
  })
})
