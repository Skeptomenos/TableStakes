import { describe, expect, it } from 'vitest'

import { applyPlayerAction } from './reducers/action-reducer'
import { recordRebuy } from './rebuy'
import { applyGameCommand } from './reducers/game-reducer'
import { mustOk, played, startedHand } from './testing'
import { undoVisibleTransaction } from './undo'
import { captureTransaction } from './visible-transactions'
import { VisibleTransactionId } from '../shared/schema/ids'
import type { GameSnapshot } from './state/types'

function playerId(s: GameSnapshot, seatIndex: number): string {
  return s.players.find((p) => p.seatIndex === seatIndex)!.id
}

describe('visible transactions and undo', () => {
  it('bundles final fold plus auto-award and undo restores the full pre-state', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })

    // Final fold: one visible transaction bundling fold + pot award +
    // hand close (the unit the table saw).
    const before = s
    const result = mustOk(
      applyPlayerAction(s, 1, { kind: 'fold' }),
      'final fold',
    )
    const transaction = captureTransaction('vtx_1', before, result)
    expect(transaction.events.map((e) => e._tag)).toEqual(
      expect.arrayContaining(['folded', 'pot-awarded', 'hand-settled']),
    )

    const undone = mustOk(
      undoVisibleTransaction(result.snapshot, transaction),
      'undo',
    )
    expect(undone.snapshot).toEqual(before)
    expect(undone.events.map((e) => e._tag)).toContain('undo-committed')
  })

  it('only the latest visible transaction can be undone', () => {
    let s = startedHand({ playerCount: 3 })
    const beforeCall = s
    const callResult = mustOk(applyPlayerAction(s, 0, { kind: 'call' }), 'call')
    const t1 = captureTransaction('vtx_1', beforeCall, callResult)
    s = callResult.snapshot

    // A second transaction happens on top.
    s = played(s, 1, { kind: 'call' })

    const result = undoVisibleTransaction(s, t1)
    expect(result.ok).toBe(false)
  })

  it('dispatches undo through the game reducer with the server-loaded transaction', () => {
    const before = startedHand({ playerCount: 3 })
    const result = mustOk(applyPlayerAction(before, 0, { kind: 'call' }), 'call')
    const transaction = captureTransaction('vtx_1', before, result)

    const undone = applyGameCommand(
      result.snapshot,
      { _tag: 'undo', expectedTransactionId: VisibleTransactionId.make('vtx_1') },
      { actingSeat: 1, latestTransaction: transaction },
    )
    expect(undone.ok).toBe(true)
    if (undone.ok) {
      expect(undone.snapshot).toEqual(before)
    }
  })

  it('rejects undo when the previewed transaction is no longer the latest', () => {
    const before = startedHand({ playerCount: 3 })
    const result = mustOk(applyPlayerAction(before, 0, { kind: 'call' }), 'call')
    const transaction = captureTransaction('vtx_2', before, result)

    const stale = applyGameCommand(
      result.snapshot,
      { _tag: 'undo', expectedTransactionId: VisibleTransactionId.make('vtx_1') },
      { actingSeat: 1, latestTransaction: transaction },
    )
    expect(stale.ok).toBe(false)
  })

  it('rejects undo when there is nothing to undo', () => {
    const s = startedHand({ playerCount: 3 })
    const result = applyGameCommand(s, { _tag: 'undo' }, { actingSeat: 0 })
    expect(result.ok).toBe(false)
  })

  it('undoes a rebuy as its own visible transaction', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    const before = s
    const rebuy = mustOk(
      recordRebuy(s, playerId(s, 0), { currency: 'EUR', cents: 500 }, 500),
      'rebuy',
    )
    const transaction = captureTransaction('vtx_r', before, rebuy)
    const undone = mustOk(
      undoVisibleTransaction(rebuy.snapshot, transaction),
      'undo rebuy',
    )
    expect(undone.snapshot).toEqual(before)
  })
})
