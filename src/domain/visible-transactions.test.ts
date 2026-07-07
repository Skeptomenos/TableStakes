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

  it('labels settings and setup single events (F1: all UI-reachable)', () => {
    expect(
      describeEvents([seat({ _tag: 'strict-mode-updated', enabled: true })]),
    ).toBe('Strict mode on')
    expect(
      describeEvents([seat({ _tag: 'strict-mode-updated', enabled: false })]),
    ).toBe('Strict mode off')
    expect(
      describeEvents([seat({ _tag: 'raise-rule-updated', rule: 'double' })]),
    ).toBe('Raise rule: double')
    expect(
      describeEvents([
        seat({ _tag: 'amount-step-updated', step: { kind: 'follow-big-blind' } }),
      ]),
    ).toBe('Change amount step')
    expect(describeEvents([seat({ _tag: 'dealer-set', seatIndex: 3 })])).toBe(
      'Set dealer',
    )
    expect(describeEvents([seat({ _tag: 'game-configured', settings: {} })])).toBe(
      'Game setup',
    )
    expect(
      describeEvents([
        seat({ _tag: 'blind-posted', seatIndex: 1, kind: 'small', amount: 50 }),
      ]),
    ).toBe('Post blind')
    expect(
      describeEvents([seat({ _tag: 'game-created', code: '11111', creatorProfileId: 'p' })]),
    ).toBe('Create game')
  })

  it('bundle labels win over single-event cases for showdown pot bundles', () => {
    // pot-created / uncalled-bet-returned never occur alone: the showdown
    // street advance bundles them under Next street, the uncontested win
    // under the pot-award labels (completeness sweep, F1).
    expect(
      describeEvents([
        seat({ _tag: 'street-advanced', street: 'showdown' }),
        seat({ _tag: 'uncalled-bet-returned', seatIndex: 0, amount: 60 }),
        seat({ _tag: 'pot-created', potId: 'p1', label: 'Main Pot' }),
      ]),
    ).toBe('Next street')
    expect(
      describeEvents([
        seat({ _tag: 'pot-created', potId: 'p1', label: 'Main Pot' }),
        seat({ _tag: 'pot-awarded', potId: 'p1', winnerId: 'w', amount: 100 }),
        seat({ _tag: 'hand-settled' }),
      ]),
    ).toBe('Award pots')
  })

  it('falls back to the raw tag for events outside the union', () => {
    // A genuinely unknown tag (not in the GameEvent union): the fallback
    // must surface it verbatim rather than invent a label (F5: the old
    // version of this test used game-configured, a KNOWN event).
    expect(describeEvents([seat({ _tag: 'not-a-real-event' })])).toBe(
      'not-a-real-event',
    )
  })
})
