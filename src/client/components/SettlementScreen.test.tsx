// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { played, runOutToShowdown, startedHand } from '../../domain/testing'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { SettlementScreen } from './SettlementScreen'

afterEach(cleanup)

// Showdown with two pots: Main Pot 600 (all three eligible) and Side Pot 1
// 400 (Player 1 and Player 3 eligible; Player 2 is all-in for 200).
function twoPotShowdown(): GameSnapshot {
  let s = startedHand({ playerCount: 3, stacks: { 1: 200 } })
  s = played(s, 0, { kind: 'raise', amount: 400 })
  s = played(s, 1, { kind: 'all-in' })
  s = played(s, 2, { kind: 'call' })
  return runOutToShowdown(s)
}

function renderScreen(snapshot: GameSnapshot) {
  const onCommand = vi.fn()
  const view = render(<SettlementScreen snapshot={snapshot} onCommand={onCommand} />)
  return { onCommand, view }
}

describe('SettlementScreen', () => {
  it('shows the header, total pot size, and ordered pot sections with eligibility', () => {
    renderScreen(twoPotShowdown())
    expect(screen.getByText('Hand Settlement')).toBeTruthy()
    expect(screen.getByText('Total Pot Size 1000')).toBeTruthy()
    const labels = [...document.querySelectorAll('.settlement__pot-label')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['Main Pot', 'Side Pot 1'])
    expect(screen.getByText('Next Hand')).toBeTruthy()
    expect(
      (screen.getByText('Next Hand') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('only offers Take All Eligible for a winner eligible for every unresolved pot', () => {
    const { onCommand } = renderScreen(twoPotShowdown())
    // No winner selected: no take-all control.
    expect(screen.queryByRole('button', { name: 'Take All Eligible' })).toBeNull()

    // Player 2 (all-in short) is only eligible for the main pot.
    fireEvent.click(screen.getByRole('radio', { name: /Player 2/ }))
    expect(screen.queryByRole('button', { name: 'Take All Eligible' })).toBeNull()

    // Player 1 is eligible for both pots.
    fireEvent.click(screen.getByRole('radio', { name: /Player 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Take All Eligible' }))
    expect(onCommand).not.toHaveBeenCalled() // confirmation first
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Take All' }))
    expect(onCommand).toHaveBeenCalledTimes(1)
    const command = onCommand.mock.calls[0]![0]
    expect(command._tag).toBe('take-all-eligible-pots')
  })

  it('awards only the first unresolved pot, with confirmation', () => {
    const { onCommand } = renderScreen(twoPotShowdown())
    // Award is disabled until an eligible winner is selected.
    const award = screen.getByRole('button', { name: 'Award Main Pot' })
    expect((award as HTMLButtonElement).disabled).toBe(true)
    // There is no award control for the side pot while the main is open.
    expect(screen.queryByRole('button', { name: 'Award Side Pot 1' })).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /Player 2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Award Main Pot' }))
    expect(onCommand).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Award' }))
    expect(onCommand).toHaveBeenCalledTimes(1)
    const command = onCommand.mock.calls[0]![0]
    expect(command._tag).toBe('award-pot')
    expect(String(command.potId)).toContain('main')
  })

  it('splits with exact inputs, live remaining feedback, and a zero-remaining gate', () => {
    const { onCommand } = renderScreen(twoPotShowdown())
    fireEvent.click(screen.getByRole('button', { name: 'Split Pot' }))

    // Exact chip inputs for the three eligible players of the main pot.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3)
    expect(screen.getByText('Remaining: 600')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Split for Player 1'), {
      target: { value: '300' },
    })
    expect(screen.getByText('Remaining: 300')).toBeTruthy()
    const confirmSplit = screen.getByRole('button', { name: 'Confirm Split' })
    expect((confirmSplit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Split for Player 2'), {
      target: { value: '300' },
    })
    expect(screen.getByText('Remaining: 0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Split' }))
    expect(onCommand).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Split' }))

    const command = onCommand.mock.calls[0]![0]
    expect(command._tag).toBe('split-pot')
    expect(command.allocations).toHaveLength(2)
    expect(command.allocations[0].chips).toBe(300)
  })

  it('cancel leaves split mode without committing', () => {
    const { onCommand } = renderScreen(twoPotShowdown())
    fireEvent.click(screen.getByRole('button', { name: 'Split Pot' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('marks pots it has seen disappear as Settled', () => {
    const first = twoPotShowdown()
    const { view } = renderScreen(first)
    // The main pot settles: the snapshot now only holds the side pot.
    const after: GameSnapshot = { ...first, pots: first.pots.slice(1) }
    view.rerender(<SettlementScreen snapshot={after} onCommand={() => {}} />)
    expect(screen.getByText('Settled')).toBeTruthy()
    const labels = [...document.querySelectorAll('.settlement__pot-label')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['Main Pot', 'Side Pot 1'])
  })
})
