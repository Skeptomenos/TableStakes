import { describe, expect, it } from 'vitest'

import { totalChipsInPlay } from './invariants'
import { applyPlayerAction } from './reducers/action-reducer'
import { confirmNextStreet } from './reducers/hand-reducer'
import { mustOk, played, startedHand } from './testing'

// Verification F3 (decided at Slice 10): uncontested wins return the
// winner's own uncalled excess as an explicit `uncalled-bet-returned` event
// — audit symmetry with the showdown path — so `pot-awarded` states only
// the contested amount. Folded chips stay dead money and are never
// returned, even when a folder committed more than the winner.

describe('uncontested win audit symmetry', () => {
  it('returns the uncalled excess before awarding only the contested pot', () => {
    // Heads-up: seat 0 (dealer/SB) raises to 500, seat 1 (BB, 100 in) folds.
    let s = startedHand({ playerCount: 2 })
    s = played(s, 0, { kind: 'raise', amount: 500 })
    const before = totalChipsInPlay(s)

    const result = mustOk(applyPlayerAction(s, 1, { kind: 'fold' }), 'fold')
    const returned = result.events.find((e) => e._tag === 'uncalled-bet-returned')
    expect(returned).toEqual({
      _tag: 'uncalled-bet-returned',
      seatIndex: 0,
      amount: 400,
    })
    const awarded = result.events.find((e) => e._tag === 'pot-awarded')
    expect(awarded).toMatchObject({ amount: 200 })

    // Chip conservation and the same final stacks as before F3.
    expect(totalChipsInPlay(result.snapshot)).toBe(before)
    expect(result.snapshot.players.find((p) => p.seatIndex === 0)!.stack).toBe(1100)
    expect(result.snapshot.players.find((p) => p.seatIndex === 1)!.stack).toBe(900)
  })

  it('keeps folded overcommitments in the pot as dead money', () => {
    // 3 players, BB all-in short (30). UTG folds, then the SB (50 posted)
    // folds: the SB is the top committer but forfeits — winner takes 80.
    let s = startedHand({ playerCount: 3, stacks: { 2: 30 } })
    s = played(s, 0, { kind: 'fold' })
    const result = mustOk(applyPlayerAction(s, 1, { kind: 'fold' }), 'fold')

    expect(
      result.events.some((e) => e._tag === 'uncalled-bet-returned'),
    ).toBe(false)
    const awarded = result.events.find((e) => e._tag === 'pot-awarded')
    expect(awarded).toMatchObject({ amount: 80 })
    expect(result.snapshot.players.find((p) => p.seatIndex === 2)!.stack).toBe(80)
  })

  it('awards exactly the called amount on a called-then-folded line', () => {
    // 3 players: seat 0 calls, seat 1 calls, seat 2 checks (all 100 in).
    // Flop: seat 1 bets 300, seat 2 folds, seat 0 folds. Excess = 300.
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'call' })
    s = played(s, 1, { kind: 'call' })
    s = played(s, 2, { kind: 'check' })
    s = mustOk(confirmNextStreet(s), 'flop').snapshot
    s = played(s, 1, { kind: 'bet', amount: 300 })
    s = played(s, 2, { kind: 'fold' })
    const result = mustOk(applyPlayerAction(s, 0, { kind: 'fold' }), 'fold')

    expect(
      result.events.find((e) => e._tag === 'uncalled-bet-returned'),
    ).toMatchObject({ seatIndex: 1, amount: 300 })
    expect(result.events.find((e) => e._tag === 'pot-awarded')).toMatchObject({
      amount: 300,
    })
    expect(result.snapshot.players.find((p) => p.seatIndex === 1)!.stack).toBe(1200)
  })
})
