// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { confirmNextStreet } from '../../domain/reducers/hand-reducer'
import { mustOk, played, runOutToShowdown, startedHand } from '../../domain/testing'
import { LiveTable } from './LiveTable'

afterEach(cleanup)

// Fixture: 3 players, blinds 50/100, dealer 0, SB 1, BB 2, actor 0.

describe('LiveTable', () => {
  it('shows seats, stacks, commitments, position badges, and the active turn', () => {
    const s = startedHand({ playerCount: 3 })
    render(<LiveTable snapshot={s} mySeat={0} />)

    expect(screen.getByText('Player 1')).toBeTruthy()
    expect(screen.getByText('950')).toBeTruthy() // SB stack
    expect(screen.getByText('900')).toBeTruthy() // BB stack
    expect(screen.getByText('Bet: 50')).toBeTruthy()
    expect(screen.getByText('Bet: 100')).toBeTruthy()
    expect(screen.getByText('D')).toBeTruthy()
    expect(screen.getByText('SB 50')).toBeTruthy()
    expect(screen.getByText('BB 100')).toBeTruthy()
    expect(screen.getByText('Your Turn')).toBeTruthy()
  })

  it('marks folded players', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    render(<LiveTable snapshot={s} mySeat={1} />)
    expect(screen.getByText('Folded')).toBeTruthy()
  })

  it('always renders five community placeholders with the street fill count', () => {
    let s = startedHand({ playerCount: 3 })
    const { container, rerender } = render(<LiveTable snapshot={s} mySeat={0} />)
    expect(container.querySelectorAll('.community__slot')).toHaveLength(5)
    expect(container.querySelectorAll('.community__slot--filled')).toHaveLength(0)

    s = played(s, 0, { kind: 'call' })
    s = played(s, 1, { kind: 'call' })
    s = played(s, 2, { kind: 'check' })
    s = mustOk(confirmNextStreet(s), 'flop').snapshot
    rerender(<LiveTable snapshot={s} mySeat={0} />)
    expect(container.querySelectorAll('.community__slot--filled')).toHaveLength(3)
  })

  it('shows the live pot total including current-street commitments', () => {
    const s = startedHand({ playerCount: 3 })
    render(<LiveTable snapshot={s} mySeat={0} />)
    // Blinds 50 + 100 are committed but no pot exists yet.
    expect(screen.getByText('Main Pot')).toBeTruthy()
    expect(screen.getByText('150')).toBeTruthy()
  })

  it('renders sitting-out visually distinct from interrupted (DESIGN.md)', () => {
    // Both are amber states, but sitting-out is a deliberate pause while
    // interrupted is a connection problem needing recovery — the badges
    // must not look identical (Slice 12 design QA).
    const base = startedHand({ playerCount: 4 })
    const s = {
      ...base,
      players: base.players.map((p) =>
        p.seatIndex === 3
          ? { ...p, handStatus: 'sitting-out' as const }
          : p.seatIndex === 2
            ? { ...p, connection: 'interrupted' as const }
            : p,
      ),
    }
    render(<LiveTable snapshot={s} mySeat={0} />)

    const sittingOut = screen.getByText(/sitting out/i)
    const interrupted = screen.getByText('Interrupted')
    expect(sittingOut.className).not.toBe(interrupted.className)
    // The pause glyph marks the deliberate-pause state.
    expect(sittingOut.textContent).toContain('⏸')
  })

  it('lists ordered pots with eligible players at showdown', () => {
    let s = startedHand({ playerCount: 3, stacks: { 1: 200 } })
    s = played(s, 0, { kind: 'raise', amount: 400 })
    s = played(s, 1, { kind: 'all-in' })
    s = played(s, 2, { kind: 'call' })
    s = runOutToShowdown(s)
    const { container } = render(<LiveTable snapshot={s} mySeat={0} />)
    expect(screen.getByText('Main Pot')).toBeTruthy()
    expect(screen.getByText('Side Pot 1')).toBeTruthy()
    const amounts = [...container.querySelectorAll('.pots__amount')].map(
      (el) => el.textContent,
    )
    expect(amounts).toEqual(['600', '400'])
  })
})
