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
    expect(screen.getByText('Bet 50')).toBeTruthy()
    expect(screen.getByText('Bet 100')).toBeTruthy()
    // Position pucks are amount-less (design uplift decision 3: blind
    // AMOUNTS live in the action-bar context line, pucks mark position).
    expect(screen.getByText('D')).toBeTruthy()
    expect(screen.getByText('SB')).toBeTruthy()
    expect(screen.getByText('BB')).toBeTruthy()
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
    // Both are attention states, but sitting-out is a deliberate pause
    // while interrupted is a connection problem needing recovery — the
    // badges must not look identical (Slice 12 design QA). Stage them on
    // NON-active seats: in a real hand a sitting-out player is never the
    // actor (they are not dealt in), and the uplift's one-pill-per-card
    // model gives the turn state priority. 4-player hand: active is seat
    // 3 (UTG), so seat 1 sits out and seat 2 is interrupted.
    const base = startedHand({ playerCount: 4 })
    const s = {
      ...base,
      players: base.players.map((p) =>
        p.seatIndex === 1
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

  it('shows Interrupted over Thinking when the ACTIVE seat is disconnected', () => {
    // Priority pin: a hand-blocking disconnected actor must surface the
    // connection problem, never a reassuring "Thinking" pill (statusFor
    // checks interrupted before the turn state — regression here would
    // hide exactly the case the recovery tools exist for).
    const base = startedHand({ playerCount: 3 })
    const active = base.hand!.activeSeat!
    const s = {
      ...base,
      players: base.players.map((p) =>
        p.seatIndex === active ? { ...p, connection: 'interrupted' as const } : p,
      ),
    }
    render(<LiveTable snapshot={s} mySeat={(active + 1) % 3} />)
    expect(screen.getByText('Interrupted')).toBeTruthy()
    expect(screen.queryByText('Thinking')).toBeNull()
  })

  it('keeps card geometry fixed regardless of badges (design uplift)', () => {
    // Locked decision 2: 96x64 always — badges float, they never resize
    // the card. Stage every badge-heavy state and compare inline sizes.
    const base = startedHand({ playerCount: 4 })
    const s = {
      ...base,
      players: base.players.map((p) =>
        p.seatIndex === 3
          ? { ...p, handStatus: 'sitting-out' as const }
          : p.seatIndex === 2
            ? { ...p, connection: 'interrupted' as const }
            : p.seatIndex === 1
              ? { ...p, handStatus: 'folded' as const }
              : p,
      ),
    }
    const { container } = render(<LiveTable snapshot={s} mySeat={0} />)
    const cards = [...container.querySelectorAll('.player-card')]
    expect(cards).toHaveLength(4)
    for (const card of cards) {
      const style = (card as HTMLElement).style
      expect(style.width).toBe('96px')
      expect(style.height).toBe('64px')
    }
  })

  it('floats pucks on the corner and status badges over the bottom border', () => {
    // Locked decisions 3+4: dealer/blind pucks live in a corner container;
    // state pills live in a bottom-border container — never inline flow.
    const s = startedHand({ playerCount: 3 })
    const { container } = render(<LiveTable snapshot={s} mySeat={0} />)
    // Dealer + blinds exist in this fixture (D on 0, SB on 1, BB on 2).
    const pucks = container.querySelectorAll('.player-card__pucks .puck')
    expect(pucks.length).toBeGreaterThanOrEqual(3)
    // Seat 0 is the hero and to act: Your turn rides the bottom border.
    const status = container.querySelector('.player-card__status')
    expect(status?.textContent).toMatch(/your turn/i)
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
