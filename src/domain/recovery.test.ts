import { describe, expect, it } from 'vitest'

import { applyGameCommand } from './reducers/game-reducer'
import { interruptSeat, markInterruptedFolded } from './seats'
import { mustOk, played, startedHand } from './testing'
import { SeatIndex } from '../shared/schema/ids'

// Recovery actions (SPEC.md Disconnect behavior): a socket drop never folds
// a player — only the visible, audited mark-interrupted-folded action does,
// and only for the blocking case where the interrupted player is due to act.

function interrupted(snapshot: ReturnType<typeof startedHand>, seat: number) {
  return mustOk(interruptSeat(snapshot, seat), 'interrupt').snapshot
}

describe('markInterruptedFolded', () => {
  it('folds an interrupted player who is due to act', () => {
    let s = startedHand({ playerCount: 3 })
    s = interrupted(s, 0)
    expect(s.hand!.activeSeat).toBe(0)

    const result = mustOk(markInterruptedFolded(s, 0), 'mark folded')
    expect(result.snapshot.players.find((p) => p.seatIndex === 0)!.handStatus).toBe(
      'folded',
    )
    expect(result.events.some((e) => e._tag === 'folded')).toBe(true)
    expect(result.snapshot.hand!.activeSeat).toBe(1)
  })

  it('bundles the uncontested auto-award when the marked fold ends the hand', () => {
    let s = startedHand({ playerCount: 2 })
    // Heads-up: seat 0 is dealer/SB and acts first.
    s = interrupted(s, 0)
    const result = mustOk(markInterruptedFolded(s, 0), 'mark folded')
    expect(result.events.some((e) => e._tag === 'pot-awarded')).toBe(true)
    expect(result.events.some((e) => e._tag === 'hand-settled')).toBe(true)
    expect(result.snapshot.game.status).toBe('between-hands')
  })

  it('rejects a connected player: they act for themselves', () => {
    const s = startedHand({ playerCount: 3 })
    expect(markInterruptedFolded(s, 0).ok).toBe(false)
  })

  it('rejects when the interrupted player is not due to act', () => {
    let s = startedHand({ playerCount: 3 })
    s = interrupted(s, 1)
    expect(s.hand!.activeSeat).toBe(0)
    const result = markInterruptedFolded(s, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toContain('due to act')
    }
  })

  it('rejects a player who already folded', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    s = interrupted(s, 0)
    expect(markInterruptedFolded(s, 0).ok).toBe(false)
  })

  it('is dispatched by the game reducer', () => {
    let s = startedHand({ playerCount: 3 })
    s = interrupted(s, 0)
    const result = applyGameCommand(
      s,
      { _tag: 'mark-interrupted-folded', seatIndex: SeatIndex.make(0) },
      { actingSeat: 1 },
    )
    expect(result.ok).toBe(true)
  })
})
