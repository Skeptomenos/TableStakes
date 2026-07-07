import { describe, expect, it } from 'vitest'

import { applyPlayerAction, type PlayerAction } from './reducers/action-reducer'
import { confirmNextStreet, startHand } from './reducers/hand-reducer'
import { makeBetweenHandsSnapshot, makeTestSettings } from './state/fixtures'
import type { GameSnapshot, RaiseRule } from './state/types'

function expectOk<T extends { ok: boolean }>(result: T) {
  expect(result.ok, JSON.stringify(result)).toBe(true)
  return result as Extract<T, { ok: true }>
}

function act(
  snapshot: GameSnapshot,
  seatIndex: number,
  action: PlayerAction,
): GameSnapshot {
  return expectOk(applyPlayerAction(snapshot, seatIndex, action)).snapshot
}

// 3 players, dealer 0, SB 1 (50), BB 2 (100), first actor 0.
function freshHand(options: {
  raiseRule?: RaiseRule
  strictMode?: boolean
  stacks?: Record<number, number>
}): GameSnapshot {
  const snapshot = makeBetweenHandsSnapshot({
    playerCount: 3,
    dealerSeat: 0,
    settings: makeTestSettings({
      raiseRule: options.raiseRule ?? 'any',
      strictMode: options.strictMode ?? false,
    }),
    playerOverrides: Object.fromEntries(
      Object.entries(options.stacks ?? {}).map(([seat, stack]) => [
        seat,
        { stack },
      ]),
    ),
  })
  return expectOk(startHand(snapshot, 'hand_1')).snapshot
}

describe('raise-rule minimums', () => {
  it('any: suggested minimum is the call amount plus one step (small blind)', () => {
    const s = freshHand({ raiseRule: 'any' })
    expect(s.hand?.minRaiseTo).toBe(150)
  })

  it('double: minimum raise doubles the current bet', () => {
    const s = freshHand({ raiseRule: 'double' })
    expect(s.hand?.minRaiseTo).toBe(200)
  })

  it('standard: minimum raise adds the last bet/raise size', () => {
    let s = freshHand({ raiseRule: 'standard' })
    expect(s.hand?.minRaiseTo).toBe(200)
    // A raise to 300 sets the last raise size to 200 -> next minimum 500.
    s = act(s, 0, { kind: 'raise', amount: 300 })
    expect(s.hand?.minRaiseTo).toBe(500)
  })

  it('standard: minimum opening bet post-flop is one big blind', () => {
    let s = freshHand({ raiseRule: 'standard' })
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'call' })
    s = act(s, 2, { kind: 'check' })
    s = expectOk(confirmNextStreet(s)).snapshot
    expect(s.hand?.minRaiseTo).toBe(100)
  })
})

describe('soft mode vs strict mode', () => {
  it('soft mode warns on a below-minimum raise but commits it', () => {
    const s = freshHand({ raiseRule: 'double', strictMode: false })
    const result = expectOk(applyPlayerAction(s, 0, { kind: 'raise', amount: 180 }))
    expect(result.warnings.map((w) => w.code)).toContain('below-minimum-raise')
    expect(result.snapshot.hand?.currentBet).toBe(180)
  })

  it('strict mode blocks a below-minimum raise', () => {
    const s = freshHand({ raiseRule: 'double', strictMode: true })
    const result = applyPlayerAction(s, 0, { kind: 'raise', amount: 180 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error._tag).toBe('StrictRuleViolation')
  })

  it('always rejects a raise that does not exceed the current bet', () => {
    for (const strictMode of [false, true]) {
      const s = freshHand({ raiseRule: 'any', strictMode })
      expect(applyPlayerAction(s, 0, { kind: 'raise', amount: 90 }).ok).toBe(false)
    }
  })

  it('soft mode warns on a check facing a bet; strict mode blocks it', () => {
    const soft = freshHand({ strictMode: false })
    const softResult = expectOk(applyPlayerAction(soft, 0, { kind: 'check' }))
    expect(softResult.warnings.map((w) => w.code)).toContain('check-facing-bet')

    const strict = freshHand({ strictMode: true })
    const strictResult = applyPlayerAction(strict, 0, { kind: 'check' })
    expect(strictResult.ok).toBe(false)
  })
})

describe('all-in below the rule minimum does not reopen betting', () => {
  function toShortAllIn(strictMode: boolean): GameSnapshot {
    // standard rule: seat 0 raises to 200; seat 1 (SB, stack 250) goes
    // all-in to 250 — above the current bet but below the 300 minimum.
    let s = freshHand({
      raiseRule: 'standard',
      strictMode,
      stacks: { 1: 250 },
    })
    s = act(s, 0, { kind: 'raise', amount: 200 })
    s = act(s, 1, { kind: 'all-in' })
    expect(s.hand?.currentBet).toBe(250)
    return s
  }

  it('lets players who have not yet acted respond freely', () => {
    let s = toShortAllIn(false)
    // Seat 2 (BB) never acted after the full raise; a re-raise is legal.
    const result = expectOk(
      applyPlayerAction(s, 2, { kind: 'raise', amount: 600 }),
    )
    expect(result.warnings).toHaveLength(0)
    s = result.snapshot
    expect(s.hand?.currentBet).toBe(600)
  })

  it('strict mode blocks a re-raise from a player who already acted', () => {
    let s = toShortAllIn(true)
    s = act(s, 2, { kind: 'call' })
    const result = applyPlayerAction(s, 0, { kind: 'raise', amount: 500 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error._tag).toBe('StrictRuleViolation')
  })

  it('soft mode warns on a re-raise from a player who already acted', () => {
    let s = toShortAllIn(false)
    s = act(s, 2, { kind: 'call' })
    const result = expectOk(
      applyPlayerAction(s, 0, { kind: 'raise', amount: 500 }),
    )
    expect(result.warnings.map((w) => w.code)).toContain(
      'betting-not-reopened',
    )
  })

  it('lets already-acted players call the short all-in and close the street', () => {
    let s = toShortAllIn(false)
    s = act(s, 2, { kind: 'call' })
    s = act(s, 0, { kind: 'call' })
    expect(s.hand?.nextStreetReady).toBe(true)
  })

  // Independent verification finding F1: the no-reopen restriction applies
  // to ALL re-raises from acted players, including all-ins (SPEC.md Raise
  // Rules has no all-in exemption).
  it('strict mode blocks an all-in re-raise from a player who already acted', () => {
    let s = toShortAllIn(true)
    s = act(s, 2, { kind: 'call' })
    const viaAllIn = applyPlayerAction(s, 0, { kind: 'all-in' })
    expect(viaAllIn.ok).toBe(false)
    if (!viaAllIn.ok) expect(viaAllIn.error._tag).toBe('StrictRuleViolation')

    const player = s.players.find((p) => p.seatIndex === 0)!
    const commitment = s.hand!.commitments.find((c) => c.seatIndex === 0)!
    const viaFullStackRaise = applyPlayerAction(s, 0, {
      kind: 'raise',
      amount: commitment.street + player.stack,
    })
    expect(viaFullStackRaise.ok).toBe(false)
  })

  it('soft mode warns on an all-in re-raise from a player who already acted', () => {
    let s = toShortAllIn(false)
    s = act(s, 2, { kind: 'call' })
    const result = expectOk(applyPlayerAction(s, 0, { kind: 'all-in' }))
    expect(result.warnings.map((w) => w.code)).toContain('betting-not-reopened')
  })
})

describe('below-minimum all-in OPENER does not reopen betting (PR #165 review)', () => {
  // Flop with BB=100: seat 1 checks, then seat 2 opens all-in for 50 —
  // below the minimum opening bet. Seat 1 already acted and must not get
  // re-raise rights back from a short all-in (SPEC.md Raise Rules).
  function toShortAllInOpener(strictMode: boolean): GameSnapshot {
    let s = freshHand({
      raiseRule: 'standard',
      strictMode,
      stacks: { 2: 150 }, // BB posts 100 pre-flop, leaving a 50 stack
    })
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'call' })
    s = act(s, 2, { kind: 'check' })
    s = expectOk(confirmNextStreet(s)).snapshot
    expect(s.hand?.street).toBe('flop')
    expect(s.hand?.activeSeat).toBe(1)

    s = act(s, 1, { kind: 'check' })
    s = act(s, 2, { kind: 'all-in' }) // opens for 50 < minimum 100
    expect(s.hand?.currentBet).toBe(50)
    s = act(s, 0, { kind: 'call' })
    return s
  }

  it('strict mode blocks a re-raise from the prior checker', () => {
    const s = toShortAllInOpener(true)
    const result = applyPlayerAction(s, 1, { kind: 'raise', amount: 300 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error._tag).toBe('StrictRuleViolation')
  })

  it('soft mode accepts the prior checker re-raise with a warning', () => {
    const s = toShortAllInOpener(false)
    const result = expectOk(
      applyPlayerAction(s, 1, { kind: 'raise', amount: 300 }),
    )
    expect(result.warnings.map((w) => w.code)).toContain(
      'betting-not-reopened',
    )
  })

  it('unacted seats respond to the short opener with full raise rights', () => {
    let s = freshHand({
      raiseRule: 'standard',
      strictMode: true,
      stacks: { 2: 150 },
    })
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'call' })
    s = act(s, 2, { kind: 'check' })
    s = expectOk(confirmNextStreet(s)).snapshot

    s = act(s, 1, { kind: 'check' })
    s = act(s, 2, { kind: 'all-in' }) // short opener for 50
    // Seat 0 never acted on the flop: a full raise is legal even in strict
    // mode, and it genuinely reopens betting for seat 1.
    const raised = expectOk(applyPlayerAction(s, 0, { kind: 'raise', amount: 300 }))
    expect(raised.warnings).toHaveLength(0)
    s = raised.snapshot
    const reraise = expectOk(applyPlayerAction(s, 1, { kind: 'raise', amount: 600 }))
    expect(reraise.warnings).toHaveLength(0)
  })

  it('the prior checker may still call the short opener and close the street', () => {
    let s = toShortAllInOpener(true)
    s = act(s, 1, { kind: 'call' })
    expect(s.hand?.nextStreetReady).toBe(true)
  })
})

describe('call with nothing owed (PR #165 re-review)', () => {
  // Post-flop, no bet live: `call` is unavailable. Strict mode rejects it;
  // soft mode normalizes to check semantics — never a `called amount: 0`
  // audit entry.
  function toOpenFlop(strictMode: boolean): GameSnapshot {
    let s = freshHand({ strictMode })
    s = act(s, 0, { kind: 'call' })
    s = act(s, 1, { kind: 'call' })
    s = act(s, 2, { kind: 'check' })
    s = expectOk(confirmNextStreet(s)).snapshot
    expect(s.hand?.street).toBe('flop')
    expect(s.hand?.currentBet).toBe(0)
    return s
  }

  it('strict mode rejects an unavailable call', () => {
    const s = toOpenFlop(true)
    const result = applyPlayerAction(s, 1, { kind: 'call' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error._tag).toBe('StrictRuleViolation')
  })

  it('soft mode normalizes it to a check with a warning', () => {
    const s = toOpenFlop(false)
    const result = expectOk(applyPlayerAction(s, 1, { kind: 'call' }))
    expect(result.warnings.map((w) => w.code)).toContain(
      'call-with-nothing-owed',
    )
    expect(result.events.map((e) => e._tag)).toEqual(['checked'])
    // The tap still counts as acting: turn advances.
    expect(result.snapshot.hand?.activeSeat).toBe(2)
  })
})
