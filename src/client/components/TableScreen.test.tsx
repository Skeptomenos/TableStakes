// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeBetweenHandsSnapshot, makeTestSettings } from '../../domain/state/fixtures'
import { startedHand } from '../../domain/testing'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { TableScreen } from './TableScreen'

afterEach(cleanup)

describe('manage pill', () => {
  it('opens and closes the manage drawer (Slice 10)', () => {
    render(
      <TableScreen
        snapshot={startedHand({ playerCount: 3 })}
        mySeat={0}
        error={null}
        onCommand={vi.fn()}
      />,
    )
    const pill = screen.getByRole('button', { name: 'Manage' }) as HTMLButtonElement
    expect(pill.disabled).toBe(false)

    fireEvent.click(pill)
    expect(screen.getByRole('dialog', { name: /manage/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog', { name: /manage/i })).toBeNull()
  })
})

// Between-hands fixtures for the busted-player flow (ADR 0003): the table
// default is 10 EUR -> 1000 chips (makeTestSettings), so the prompt card's
// primary button copy is pinned to "Rebuy 10 EUR → 1000 chips".
function betweenHands(playerOverrides: Parameters<typeof makeBetweenHandsSnapshot>[0]['playerOverrides']): GameSnapshot {
  return makeBetweenHandsSnapshot({
    playerCount: 3,
    settings: makeTestSettings(),
    playerOverrides,
  })
}

describe('needs-rebuy prompt card', () => {
  it('shows the hero prompt with the default rebuy, custom rebuy, and sit out when the viewer busted', () => {
    const s = betweenHands({
      0: { stack: 0, handStatus: 'needs-rebuy' },
    })
    render(<TableScreen snapshot={s} mySeat={0} error={null} onCommand={vi.fn()} />)
    expect(screen.getByText("You're out of chips.")).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Rebuy 10 EUR → 1000 chips' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Custom rebuy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sit out' })).toBeTruthy()
  })

  it('shows no prompt card when the viewer has chips', () => {
    const s = betweenHands({
      0: { stack: 500 },
      1: { stack: 0, handStatus: 'needs-rebuy' },
    })
    render(<TableScreen snapshot={s} mySeat={0} error={null} onCommand={vi.fn()} />)
    expect(screen.queryByText("You're out of chips.")).toBeNull()
  })

  it('one-tap rebuy fires record-rebuy at exactly the table default after confirmation', () => {
    const onCommand = vi.fn()
    const s = betweenHands({ 0: { stack: 0, handStatus: 'needs-rebuy' } })
    render(<TableScreen snapshot={s} mySeat={0} error={null} onCommand={onCommand} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Rebuy 10 EUR → 1000 chips' }),
    )
    expect(onCommand).not.toHaveBeenCalled() // confirmation first
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Rebuy' }))
    expect(onCommand).toHaveBeenCalledTimes(1)
    const command = onCommand.mock.calls[0]![0]
    expect(command._tag).toBe('record-rebuy')
    // The HERO's own id — a wrong-player rebuy at the right amount would
    // corrupt the night's books (FINAL-verification finding: unpinned).
    expect(command.playerId).toBe(s.players.find((p) => p.seatIndex === 0)!.id)
    expect(command.money).toEqual({ currency: 'EUR', cents: 1000 })
    expect(command.chips).toBe(1000)
  })

  it('sit out fires the sit-out command', () => {
    const onCommand = vi.fn()
    const s = betweenHands({ 0: { stack: 0, handStatus: 'needs-rebuy' } })
    render(<TableScreen snapshot={s} mySeat={0} error={null} onCommand={onCommand} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sit out' }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'sit-out' })
  })

  it('custom rebuy opens the Manage drawer directly on the rebuy view, preselected to the viewer', () => {
    // Hero at seat 2, NOT seat 0: with mySeat=0 this assertion is vacuous
    // (RebuyForm's players[0] fallback matches the hero anyway) and would
    // pass without the preselection threading (FINAL-verification finding).
    const s = betweenHands({
      2: { stack: 0, handStatus: 'needs-rebuy' },
    })
    render(<TableScreen snapshot={s} mySeat={2} error={null} onCommand={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom rebuy' }))
    expect(screen.getByRole('dialog', { name: /manage/i })).toBeTruthy()
    expect(screen.getByText('Rebuy / Add Chips')).toBeTruthy()
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe(s.players.find((p) => p.seatIndex === 2)!.id)
  })
})

describe('Next Hand gating (ADR 0003)', () => {
  it('disables Next Hand with a reason when fewer than 2 seated players have chips', () => {
    const s = betweenHands({
      0: { stack: 0, handStatus: 'needs-rebuy' },
      1: { stack: 500 },
      2: { stack: 0, handStatus: 'needs-rebuy' },
    })
    render(<TableScreen snapshot={s} mySeat={1} error={null} onCommand={vi.fn()} />)
    const nextHand = screen.getByRole('button', { name: 'Next Hand' }) as HTMLButtonElement
    expect(nextHand.disabled).toBe(true)
    expect(
      screen.getByText('Waiting for players to rebuy — need 2 with chips'),
    ).toBeTruthy()
  })

  it('enables Next Hand once 2 or more seated players have chips', () => {
    const s = betweenHands({
      0: { stack: 500 },
      1: { stack: 500 },
      2: { stack: 0, handStatus: 'needs-rebuy' },
    })
    render(<TableScreen snapshot={s} mySeat={0} error={null} onCommand={vi.fn()} />)
    const nextHand = screen.getByRole('button', { name: 'Next Hand' }) as HTMLButtonElement
    expect(nextHand.disabled).toBe(false)
    expect(
      screen.queryByText('Waiting for players to rebuy — need 2 with chips'),
    ).toBeNull()
  })
})
