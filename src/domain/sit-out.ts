import { replacePlayer } from './betting'
import { err, ok, type ReducerResult } from './result'
import { InvalidAction } from './state/errors'
import type { GameSnapshot } from './state/types'

// Sit-out and return (SPEC.md): both act on the requesting player's own
// claimed seat and take effect from the next hand. A contesting player
// finishes the current hand first; a returning player is dealt in with no
// missed-blind penalty. `canDealIn` reads the flag, so start-hand skips
// flagged seats for blinds and action automatically.

export function sitOut(snapshot: GameSnapshot, seatIndex: number): ReducerResult {
  if (snapshot.game.status === 'finished') {
    return err(new InvalidAction({ reason: 'game is finished' }))
  }
  const player = snapshot.players.find((p) => p.seatIndex === seatIndex)
  if (!player) {
    return err(new InvalidAction({ reason: 'no player on that seat' }))
  }
  if (player.sitOutNextHand) {
    return err(new InvalidAction({ reason: 'already sitting out' }))
  }

  const midHand =
    snapshot.game.status === 'in-hand' || snapshot.game.status === 'showdown'
  const next = {
    ...player,
    sitOutNextHand: true,
    // Between hands the badge flips immediately; mid-hand the current hand
    // status is untouched — the player finishes the hand they are in.
    handStatus: midHand
      ? player.handStatus
      : player.stack === 0
        ? ('needs-rebuy' as const)
        : ('sitting-out' as const),
  }
  return ok(
    { ...snapshot, players: replacePlayer(snapshot.players, next) },
    [{ _tag: 'sat-out', seatIndex: player.seatIndex }],
  )
}

export function returnFromSitOut(
  snapshot: GameSnapshot,
  seatIndex: number,
): ReducerResult {
  if (snapshot.game.status === 'finished') {
    return err(new InvalidAction({ reason: 'game is finished' }))
  }
  const player = snapshot.players.find((p) => p.seatIndex === seatIndex)
  if (!player) {
    return err(new InvalidAction({ reason: 'no player on that seat' }))
  }
  if (!player.sitOutNextHand && player.handStatus !== 'sitting-out') {
    return err(new InvalidAction({ reason: 'player is not sitting out' }))
  }

  const midHand =
    snapshot.game.status === 'in-hand' || snapshot.game.status === 'showdown'
  const next = {
    ...player,
    sitOutNextHand: false,
    handStatus:
      midHand || player.handStatus !== 'sitting-out'
        ? player.handStatus
        : player.stack === 0
          ? ('needs-rebuy' as const)
          : ('waiting' as const),
  }
  return ok(
    { ...snapshot, players: replacePlayer(snapshot.players, next) },
    [{ _tag: 'returned-from-sit-out', seatIndex: player.seatIndex }],
  )
}
