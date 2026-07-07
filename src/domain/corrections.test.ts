import { describe, expect, it } from 'vitest'

import {
  applyCorrection,
  restoreFoldedPlayer,
  setActivePlayer,
} from './corrections'
import { totalChipsInPlay } from './invariants'
import { applyGameCommand } from './reducers/game-reducer'
import { mustOk, played, runOutToShowdown, startedHand } from './testing'
import type { CorrectionMove } from '../shared/schema/events'
import { SeatIndex } from '../shared/schema/ids'

// Corrections (SPEC.md Undo And Corrections): zero-sum chip moves between
// stacks and pots plus named state tools. Amounts change; the total chips
// in play never do, and hand statuses are never touched by chip moves.

function stackMove(playerId: string, delta: number): CorrectionMove {
  return { target: { kind: 'player-stack', playerId }, delta } as CorrectionMove
}

function potMove(potId: string, delta: number): CorrectionMove {
  return { target: { kind: 'pot', potId }, delta } as CorrectionMove
}

describe('applyCorrection', () => {
  it('moves chips between stacks and writes an audit event', () => {
    const s = startedHand({ playerCount: 3 })
    const [a, b] = [s.players[0]!, s.players[1]!]
    const before = totalChipsInPlay(s)

    const moves = [stackMove(a.id, -100), stackMove(b.id, 100)]
    const result = mustOk(applyCorrection(s, 'stack miscount', moves), 'correct')

    expect(result.snapshot.players.find((p) => p.id === a.id)!.stack).toBe(
      a.stack - 100,
    )
    expect(result.snapshot.players.find((p) => p.id === b.id)!.stack).toBe(
      b.stack + 100,
    )
    expect(totalChipsInPlay(result.snapshot)).toBe(before)
    expect(result.events).toEqual([
      { _tag: 'correction-committed', reason: 'stack miscount', moves },
    ])
  })

  it('corrects a pot amount against a stack at showdown', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'call' })
    s = played(s, 1, { kind: 'call' })
    s = played(s, 2, { kind: 'check' })
    s = runOutToShowdown(s)
    const pot = s.pots[0]!
    const player = s.players[0]!
    const before = totalChipsInPlay(s)

    const result = mustOk(
      applyCorrection(s, 'pot short by 50', [
        stackMove(player.id, -50),
        potMove(pot.id, 50),
      ]),
      'correct',
    )
    expect(result.snapshot.pots[0]!.amount).toBe(pot.amount + 50)
    expect(totalChipsInPlay(result.snapshot)).toBe(before)
  })

  it('rejects a move that would make a stack negative', () => {
    const s = startedHand({ playerCount: 3 })
    const [a, b] = [s.players[0]!, s.players[1]!]
    const result = applyCorrection(s, 'too big', [
      stackMove(a.id, -5000),
      stackMove(b.id, 5000),
    ])
    expect(result.ok).toBe(false)
  })

  it('rejects unknown players and unknown pots', () => {
    const s = startedHand({ playerCount: 3 })
    const a = s.players[0]!
    expect(
      applyCorrection(s, 'ghost', [
        stackMove(a.id, -10),
        stackMove('player_ghost', 10),
      ]).ok,
    ).toBe(false)
    expect(
      applyCorrection(s, 'no pot yet', [
        stackMove(a.id, -10),
        potMove('pot_missing', 10),
      ]).ok,
    ).toBe(false)
  })

  it('re-checks the zero-sum invariant in the domain', () => {
    const s = startedHand({ playerCount: 3 })
    const a = s.players[0]!
    expect(applyCorrection(s, 'not zero sum', [stackMove(a.id, 100)]).ok).toBe(false)
  })

  it('validates the NET end-state, never intermediate move order (PR #182 review)', () => {
    // Seat 0 is the dealer and posts no blind, so its stack stays 100.
    const s = startedHand({ playerCount: 3, stacks: { 0: 100 } })
    const a = s.players.find((p) => p.seatIndex === 0)!
    const b = s.players.find((p) => p.seatIndex === 1)!
    // Net for A is -100 (final stack 0), but the first move alone would
    // drive A to -50: sequential validation wrongly rejects this.
    const result = applyCorrection(s, 'order-sensitive rebalance', [
      stackMove(a.id, -150),
      stackMove(a.id, 50),
      stackMove(b.id, 100),
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.players.find((p) => p.id === a.id)!.stack).toBe(0)
      expect(result.snapshot.players.find((p) => p.id === b.id)!.stack).toBe(
        b.stack + 100,
      )
    }
  })

  it('still rejects a net-negative target in any order', () => {
    const s = startedHand({ playerCount: 3, stacks: { 0: 100 } })
    const a = s.players.find((p) => p.seatIndex === 0)!
    const b = s.players.find((p) => p.seatIndex === 1)!
    expect(
      applyCorrection(s, 'net negative', [
        stackMove(b.id, 150),
        stackMove(a.id, -150),
      ]).ok,
    ).toBe(false)
  })

  it('never changes hand statuses: an all-in player stays all-in', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'all-in' })
    const allIn = s.players.find((p) => p.seatIndex === 0)!
    expect(allIn.handStatus).toBe('all-in')

    const other = s.players.find((p) => p.seatIndex === 1)!
    const result = mustOk(
      applyCorrection(s, 'found chips on the floor', [
        stackMove(other.id, -100),
        stackMove(allIn.id, 100),
      ]),
      'correct',
    )
    const corrected = result.snapshot.players.find((p) => p.id === allIn.id)!
    expect(corrected.stack).toBe(100)
    expect(corrected.handStatus).toBe('all-in')
  })

  it('is dispatched by the game reducer', () => {
    const s = startedHand({ playerCount: 3 })
    const [a, b] = [s.players[0]!, s.players[1]!]
    const result = applyGameCommand(
      s,
      {
        _tag: 'apply-correction',
        reason: 'stack miscount',
        moves: [stackMove(a.id, -10), stackMove(b.id, 10)],
      },
      { actingSeat: 0 },
    )
    expect(result.ok).toBe(true)
  })

  it('dispatches the named state tools by command tag (verification finding)', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })

    const restored = applyGameCommand(
      s,
      { _tag: 'restore-folded-player', seatIndex: SeatIndex.make(0) },
      { actingSeat: 1 },
    )
    expect(restored.ok).toBe(true)
    if (restored.ok) {
      expect(restored.events).toEqual([
        { _tag: 'folded-player-restored', seatIndex: 0 },
      ])
      const turned = applyGameCommand(
        restored.snapshot,
        { _tag: 'set-active-player', seatIndex: SeatIndex.make(2) },
        { actingSeat: 1 },
      )
      expect(turned.ok).toBe(true)
      if (turned.ok) {
        expect(turned.snapshot.hand!.activeSeat).toBe(2)
      }
    }
  })
})

describe('restoreFoldedPlayer', () => {
  it('returns a mistaken fold to active and reopens their action', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    const result = mustOk(restoreFoldedPlayer(s, 0), 'restore')

    const player = result.snapshot.players.find((p) => p.seatIndex === 0)!
    expect(player.handStatus).toBe('waiting')
    expect(result.snapshot.hand!.actedSeats).not.toContain(0)
    expect(result.snapshot.hand!.nextStreetReady).toBe(false)
    expect(result.events).toEqual([{ _tag: 'folded-player-restored', seatIndex: 0 }])
  })

  it('takes the turn pointer when the street had closed', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    s = played(s, 1, { kind: 'call' })
    s = played(s, 2, { kind: 'check' })
    expect(s.hand!.nextStreetReady).toBe(true)

    const result = mustOk(restoreFoldedPlayer(s, 0), 'restore')
    expect(result.snapshot.hand!.activeSeat).toBe(0)
    expect(result.snapshot.hand!.nextStreetReady).toBe(false)
  })

  it('rejects players who are not folded and rejects showdown', () => {
    const s = startedHand({ playerCount: 3 })
    expect(restoreFoldedPlayer(s, 0).ok).toBe(false)

    let shown = startedHand({ playerCount: 3 })
    shown = played(shown, 0, { kind: 'fold' })
    shown = played(shown, 1, { kind: 'call' })
    shown = played(shown, 2, { kind: 'check' })
    shown = runOutToShowdown(shown)
    expect(restoreFoldedPlayer(shown, 0).ok).toBe(false)
  })
})

describe('setActivePlayer', () => {
  it('moves the turn pointer to another actionable seat', () => {
    const s = startedHand({ playerCount: 3 })
    expect(s.hand!.activeSeat).toBe(0)
    const result = mustOk(setActivePlayer(s, 2), 'set active')
    expect(result.snapshot.hand!.activeSeat).toBe(2)
    expect(result.snapshot.hand!.nextStreetReady).toBe(false)
    expect(result.events).toEqual([{ _tag: 'active-player-set', seatIndex: 2 }])
  })

  it('rejects folded or all-in targets and requires an active hand', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    expect(setActivePlayer(s, 0).ok).toBe(false)

    let allIn = startedHand({ playerCount: 3 })
    allIn = played(allIn, 0, { kind: 'all-in' })
    expect(setActivePlayer(allIn, 0).ok).toBe(false)
  })
})
