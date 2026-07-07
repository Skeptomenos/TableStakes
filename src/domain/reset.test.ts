import { describe, expect, it } from 'vitest'

import { recordRebuy } from './rebuy'
import { applyGameCommand } from './reducers/game-reducer'
import { resetGame } from './reset'
import { mustOk, played, startedHand } from './testing'
import { makeBetweenHandsSnapshot, makeTestPlayer } from './state/fixtures'

// Game reset (SPEC.md): back to first-hand setup, stacks equal to total
// purchased chips, keeping profiles, buy-in records, and event history.

describe('resetGame', () => {
  it('returns to setup with stacks equal to purchased chips', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'raise', amount: 400 })
    s = played(s, 1, { kind: 'fold' })

    const result = mustOk(resetGame(s), 'reset')
    expect(result.snapshot.game.status).toBe('setup')
    expect(result.snapshot.hand).toBeNull()
    expect(result.snapshot.pots).toEqual([])
    for (const player of result.snapshot.players) {
      expect(player.stack).toBe(player.totalChipsPurchased)
      expect(player.pendingRebuyChips).toBe(0)
      expect(player.sitOutNextHand).toBe(false)
      expect(player.handStatus).toBe('waiting')
    }
    expect(result.events).toEqual([{ _tag: 'game-reset' }])
  })

  it('includes rebuys in the purchased total', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    const folded = s.players.find((p) => p.seatIndex === 0)!
    s = mustOk(
      recordRebuy(s, folded.id, { currency: 'EUR', cents: 500 }, 500),
      'rebuy',
    ).snapshot

    const reset = mustOk(resetGame(s), 'reset').snapshot
    expect(reset.players.find((p) => p.seatIndex === 0)!.stack).toBe(1500)
  })

  it('keeps buy-in records and hand-number history', () => {
    const s = startedHand({ playerCount: 3 })
    const reset = mustOk(resetGame(s), 'reset').snapshot
    for (const player of reset.players) {
      expect(player.totalBuyInCents).toBe(1000)
      expect(player.totalChipsPurchased).toBe(1000)
    }
    expect(reset.game.lastHandNumber).toBe(s.game.lastHandNumber)
  })

  it('marks players with no purchases as needing a rebuy', () => {
    const base = makeBetweenHandsSnapshot({ playerCount: 2 })
    const s = {
      ...base,
      players: [
        ...base.players,
        makeTestPlayer(2, {
          stack: 0,
          totalBuyInCents: 0,
          totalChipsPurchased: 0,
          handStatus: 'needs-rebuy',
        }),
      ],
    }
    const reset = mustOk(resetGame(s), 'reset').snapshot
    expect(reset.players.find((p) => p.seatIndex === 2)!.handStatus).toBe(
      'needs-rebuy',
    )
  })

  it('rejects when the game is finished', () => {
    const base = makeBetweenHandsSnapshot({ playerCount: 2 })
    const s = { ...base, game: { ...base.game, status: 'finished' as const } }
    expect(resetGame(s).ok).toBe(false)
  })

  it('is dispatched by the game reducer', () => {
    const s = startedHand({ playerCount: 3 })
    const result = applyGameCommand(s, { _tag: 'reset-game' }, { actingSeat: 0 })
    expect(result.ok).toBe(true)
  })
})
