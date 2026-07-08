// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeTestSettings } from '../../domain/state/fixtures'
import { BuyInConfirm } from './BuyInConfirm'

afterEach(cleanup)

// ADR 0002: the buy-in confirmation states the fixed default plainly, one
// tap, no amount entry — nothing here can send anything but the exact
// snapshot default.
describe('BuyInConfirm', () => {
  it('shows the money-to-chip ratio and the exact confirm label (SPEC.md example economy)', () => {
    render(
      <BuyInConfirm settings={makeTestSettings()} onConfirm={() => {}} />,
    )
    expect(screen.getByText('10 EUR = 1000 chips')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Buy in for 10 EUR → 1000 chips' }),
    ).toBeTruthy()
  })

  it('has no amount input anywhere — the amount is fixed, not entered', () => {
    render(
      <BuyInConfirm settings={makeTestSettings()} onConfirm={() => {}} />,
    )
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('confirms with a single tap', () => {
    const onConfirm = vi.fn()
    render(
      <BuyInConfirm settings={makeTestSettings()} onConfirm={onConfirm} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /buy in for/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('renders fractional-cent defaults without a spurious trailing zero pattern break', () => {
    render(
      <BuyInConfirm
        settings={makeTestSettings({ defaultBuyInCents: 1050, defaultStack: 1050 })}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText('10.50 EUR = 1050 chips')).toBeTruthy()
  })
})
