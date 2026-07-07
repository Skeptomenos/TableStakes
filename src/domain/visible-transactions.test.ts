import { describe, expect, it } from 'vitest'

import { describeEvents } from './visible-transactions'
import type { GameEvent } from './state/types'

// Undo confirmation copy (Slice 12 polish): plain player actions get
// friendly casing so the drawer never shows "Reverses: checked (checked)".

const seat = (raw: object) => raw as unknown as GameEvent

describe('describeEvents', () => {
  it('labels bundled outcomes by their most significant events', () => {
    expect(
      describeEvents([
        seat({ _tag: 'folded', seatIndex: 1 }),
        seat({ _tag: 'pot-awarded', potId: 'p', winnerId: 'w', amount: 100 }),
      ]),
    ).toBe('Fold and award pot')
  })

  it('gives plain player actions friendly labels instead of raw tags', () => {
    expect(describeEvents([seat({ _tag: 'checked', seatIndex: 0 })])).toBe('Check')
    expect(describeEvents([seat({ _tag: 'folded', seatIndex: 0 })])).toBe('Fold')
    expect(
      describeEvents([seat({ _tag: 'called', seatIndex: 0, amount: 100 })]),
    ).toBe('Call 100')
    expect(describeEvents([seat({ _tag: 'bet', seatIndex: 0, amount: 150 })])).toBe(
      'Bet 150',
    )
    expect(
      describeEvents([seat({ _tag: 'raised', seatIndex: 0, amount: 300 })]),
    ).toBe('Raise to 300')
    expect(
      describeEvents([seat({ _tag: 'all-in', seatIndex: 0, amount: 900 })]),
    ).toBe('All-in 900')
  })

  it('labels recovery and lifecycle single events without duplication', () => {
    expect(describeEvents([seat({ _tag: 'sat-out', seatIndex: 2 })])).toBe('Sit out')
    expect(
      describeEvents([seat({ _tag: 'returned-from-sit-out', seatIndex: 2 })]),
    ).toBe('Return from sit-out')
    expect(
      describeEvents([seat({ _tag: 'seat-released', seatIndex: 2, playerId: 'p' })]),
    ).toBe('Release seat')
    expect(
      describeEvents([
        seat({ _tag: 'seat-claimed', seatIndex: 2, playerId: 'p', profileId: 'x' }),
      ]),
    ).toBe('Claim seat')
  })

  it('falls back to the raw tag only for unknown events', () => {
    expect(describeEvents([seat({ _tag: 'game-configured', settings: {} })])).toBe(
      'game-configured',
    )
  })
})
