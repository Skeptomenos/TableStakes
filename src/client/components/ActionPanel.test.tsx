// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { confirmNextStreet } from '../../domain/reducers/hand-reducer'
import { mustOk, played, startedHand } from '../../domain/testing'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { ActionPanel } from './ActionPanel'

afterEach(cleanup)

// Default fixture: 3 players, blinds 50/100, dealer 0, SB 1, BB 2, actor 0,
// raise rule `any` with follow-small-blind step (min raise-to 150).

function renderPanel(snapshot: GameSnapshot, mySeat: number) {
  const onCommand = vi.fn()
  render(<ActionPanel snapshot={snapshot} mySeat={mySeat} onCommand={onCommand} />)
  return onCommand
}

function renderWithContainer(snapshot: GameSnapshot, mySeat: number) {
  const onCommand = vi.fn()
  const utils = render(
    <ActionPanel snapshot={snapshot} mySeat={mySeat} onCommand={onCommand} />,
  )
  return { ...utils, onCommand }
}

describe('amount selection', () => {
  it('defaults to the current minimum and shows blinds context', () => {
    renderPanel(startedHand({ playerCount: 3 }), 0)
    expect(screen.getByText('Blinds: 50 / 100')).toBeTruthy()
    expect(screen.getByText('Min Raise: 150')).toBeTruthy()
    expect(screen.getByTestId('amount-display').textContent).toContain('150')
  })

  it('steps by the small blind with plus/minus, clamped to the minimum', () => {
    renderPanel(startedHand({ playerCount: 3 }), 0)
    fireEvent.click(screen.getByRole('button', { name: 'Increase amount' }))
    expect(screen.getByTestId('amount-display').textContent).toContain('200')
    fireEvent.click(screen.getByRole('button', { name: 'Decrease amount' }))
    fireEvent.click(screen.getByRole('button', { name: 'Decrease amount' }))
    expect(screen.getByTestId('amount-display').textContent).toContain('150')
  })

  it('hides exact numeric entry until the amount display is tapped', () => {
    renderPanel(startedHand({ playerCount: 3 }), 0)
    expect(screen.queryByRole('spinbutton')).toBeNull()
    fireEvent.click(screen.getByTestId('amount-display'))
    expect(screen.getByRole('spinbutton')).toBeTruthy()
  })

  it('offers no quick-chip preset buttons', () => {
    renderPanel(startedHand({ playerCount: 3 }), 0)
    expect(screen.queryByText(/\+1 BB|\+5 BB|half stack/i)).toBeNull()
  })
})

describe('actions', () => {
  it('submits check immediately when nothing is owed', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'call' })
    s = played(s, 1, { kind: 'call' })
    // Big blind option: seat 2 owes nothing.
    const onCommand = renderPanel(s, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'check' })
  })

  it('submits call with the owed amount immediately', () => {
    const onCommand = renderPanel(startedHand({ playerCount: 3 }), 0)
    fireEvent.click(screen.getByRole('button', { name: 'Call 100' }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'call' })
  })

  it('requires confirmation for fold', () => {
    const onCommand = renderPanel(startedHand({ playerCount: 3 }), 0)
    fireEvent.click(screen.getByRole('button', { name: 'Fold' }))
    expect(onCommand).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Fold' }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'fold' })
  })

  it('labels a short-stack call as Call All-in with confirmation', () => {
    const s = startedHand({ playerCount: 3, stacks: { 0: 60 } })
    const onCommand = renderPanel(s, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Call All-in 60' }))
    expect(onCommand).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Call All-in' }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'call' })
  })

  it('labels aggression Raise pre-flop and Bet on an open street', () => {
    let s = startedHand({ playerCount: 3 })
    expect(
      render(
        <ActionPanel snapshot={s} mySeat={0} onCommand={() => {}} />,
      ).getByRole('button', { name: 'Raise 150' }),
    ).toBeTruthy()
    cleanup()

    s = played(s, 0, { kind: 'call' })
    s = played(s, 1, { kind: 'call' })
    s = played(s, 2, { kind: 'check' })
    s = mustOk(confirmNextStreet(s), 'flop').snapshot
    // Flop, no live bet, SB (seat 1) first: opening bet.
    renderPanel(s, 1)
    expect(screen.getByRole('button', { name: /^Bet 50$/ })).toBeTruthy()
  })

  it('submits a standard raise without confirmation', () => {
    const onCommand = renderPanel(startedHand({ playerCount: 3 }), 0)
    fireEvent.click(screen.getByRole('button', { name: 'Raise 150' }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'raise', amount: 150 })
  })

  it('normalizes a full-stack raise to a confirmed all-in', () => {
    const onCommand = renderPanel(startedHand({ playerCount: 3 }), 0)
    fireEvent.click(screen.getByTestId('amount-display'))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'All-In' }))
    expect(onCommand).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm All-In' }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'go-all-in' })
  })

  it('disables actions when it is not my turn', () => {
    renderPanel(startedHand({ playerCount: 3 }), 1)
    expect(
      (screen.getByRole('button', { name: 'Fold' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('renders a stable four-slot action row with mono sub-amounts (uplift)', () => {
    // Design uplift Slice 3: Fold | Check/Call | Bet/Raise | All-In as
    // equal segments; amounts live in a .num sub-element under the label.
    const { container } = renderWithContainer(startedHand({ playerCount: 3 }), 0)
    const row = container.querySelector('.action-panel__row')!
    const buttons = [...row.querySelectorAll(':scope > button')]
    expect(buttons.map((b) => b.textContent?.trim().split(/\s+/)[0])).toEqual([
      'Fold',
      'Call',
      'Raise',
      'All-In',
    ])
    // Call and Raise carry their amounts as mono sub-elements.
    expect(buttons[1]!.querySelector('.num')?.textContent).toBe('100')
    expect(buttons[2]!.querySelector('.num')?.textContent).toBe('150')
  })

  it('keeps claret off resting buttons — destructive color is confirm-only (uplift)', () => {
    // Gap analysis rejected the mock's red-at-rest: Fold/All-In rest
    // neutral; claret appears only inside the confirm sheet.
    const { container } = renderWithContainer(startedHand({ playerCount: 3 }), 0)
    const row = container.querySelector('.action-panel__row')!
    expect(row.querySelector('.button--danger')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Fold' }))
    expect(document.querySelector('.confirm-sheet .button--danger')).toBeTruthy()
  })
})

describe('soft vs strict below-minimum entry', () => {
  it('soft mode warns on a below-minimum exact entry but allows the commit', () => {
    const onCommand = renderPanel(startedHand({ playerCount: 3 }), 0)
    fireEvent.click(screen.getByTestId('amount-display'))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '120' } })
    expect(screen.getByText(/below the minimum/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Raise 120' }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'raise', amount: 120 })
  })

  it('strict mode never blocks a legal short-stack all-in (PR #179 review)', () => {
    // Seat 0 owes 100 with a 120 stack: max bet-to (120) is below the
    // minimum raise (150). An all-in below the rule minimum is always
    // legal — strict mode must not dead-end it.
    const s = startedHand({ playerCount: 3, strictMode: true, stacks: { 0: 120 } })
    const onCommand = renderPanel(s, 0)

    const allInSlot = screen.getByRole('button', {
      name: 'All-In 120',
    }) as HTMLButtonElement
    expect(allInSlot.disabled).toBe(false)
    expect(screen.queryByText(/strict mode: minimum/i)).toBeNull()

    fireEvent.click(allInSlot)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm All-In' }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'go-all-in' })
  })

  it('slider collapses to the reachable total when the minimum exceeds it (F2)', () => {
    // Same capped-short-stack state: minRaiseTo 150 > reach 120. The
    // thumb must sit on the one committable amount (120), not render
    // pinned at an uncommittable min of 150 (post-verification F2).
    const s = startedHand({ playerCount: 3, strictMode: true, stacks: { 0: 120 } })
    renderPanel(s, 0)

    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.min).toBe('120')
    expect(slider.max).toBe('120')
    expect(slider.value).toBe('120')
    expect(screen.getByTestId('amount-display').textContent).toContain('120')
  })

  it('strict mode blocks a below-minimum exact entry', () => {
    const onCommand = renderPanel(
      startedHand({ playerCount: 3, strictMode: true }),
      0,
    )
    fireEvent.click(screen.getByTestId('amount-display'))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '120' } })
    const raise = screen.getByRole('button', { name: 'Raise 120' }) as HTMLButtonElement
    expect(raise.disabled).toBe(true)
    fireEvent.click(raise)
    expect(onCommand).not.toHaveBeenCalled()
  })
})
