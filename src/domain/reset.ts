import { makeChips } from '../shared/chips'
import { err, ok, type ReducerResult } from './result'
import { InvalidAction } from './state/errors'
import type { GameSnapshot } from './state/types'

/**
 * Game reset (SPEC.md): back to first-hand setup with every stack equal to
 * that player's total purchased chips. Profiles, buy-in records, and the
 * event history stay — reset is a table-state disaster switch, not a wipe.
 */
export function resetGame(snapshot: GameSnapshot): ReducerResult {
  if (snapshot.game.status === 'finished') {
    return err(new InvalidAction({ reason: 'game is finished' }))
  }

  const players = snapshot.players.map((p) => ({
    ...p,
    stack: p.totalChipsPurchased,
    pendingRebuyChips: makeChips(0),
    sitOutNextHand: false,
    handStatus:
      p.totalChipsPurchased === 0
        ? ('needs-rebuy' as const)
        : ('waiting' as const),
  }))

  return ok(
    {
      ...snapshot,
      game: {
        ...snapshot.game,
        status: 'setup',
        settings: snapshot.game.pendingSettings ?? snapshot.game.settings,
        pendingSettings: null,
      },
      players,
      hand: null,
      pots: [],
    },
    [{ _tag: 'game-reset' }],
  )
}
