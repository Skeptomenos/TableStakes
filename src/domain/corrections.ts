import { makeChips } from '../shared/chips'
import type { CorrectionMove } from '../shared/schema/events'
import { replacePlayer } from './betting'
import { err, ok, type ReducerResult } from './result'
import { isActionable } from './turn-order'
import { InvalidAction } from './state/errors'
import type { GameSnapshot } from './state/types'

// Correction tools (SPEC.md Undo And Corrections). Chip corrections are
// zero-sum moves between stacks and built pots: amounts change, hand
// statuses never do, and the total chips in play is invariant. State
// mistakes (a wrong fold, a wrong turn pointer) have named tools with
// their own audit events instead of being disguised as chip moves.

export function applyCorrection(
  snapshot: GameSnapshot,
  reason: string,
  moves: readonly CorrectionMove[],
): ReducerResult {
  if (snapshot.game.status === 'finished') {
    return err(new InvalidAction({ reason: 'game is finished' }))
  }
  if (moves.length === 0) {
    return err(new InvalidAction({ reason: 'correction needs at least one move' }))
  }
  // The schema enforces zero-sum; re-check here so the invariant holds for
  // every caller of the domain, not just the command pipeline.
  const sum = moves.reduce((total, move) => total + move.delta, 0)
  if (sum !== 0) {
    return err(
      new InvalidAction({ reason: 'correction moves must sum to zero' }),
    )
  }

  // Aggregate per target and validate the NET end-state: a valid zero-sum
  // correction must never be rejected because an intermediate move order
  // temporarily dips below zero (PR #182 review).
  const playerDeltas = new Map<string, number>()
  const potDeltas = new Map<string, number>()
  for (const move of moves) {
    const target = move.target
    if (target.kind === 'player-stack') {
      if (!snapshot.players.some((p) => p.id === target.playerId)) {
        return err(new InvalidAction({ reason: 'unknown player in correction' }))
      }
      playerDeltas.set(
        target.playerId,
        (playerDeltas.get(target.playerId) ?? 0) + move.delta,
      )
    } else {
      if (!snapshot.pots.some((p) => p.id === target.potId)) {
        return err(new InvalidAction({ reason: 'unknown pot in correction' }))
      }
      potDeltas.set(target.potId, (potDeltas.get(target.potId) ?? 0) + move.delta)
    }
  }

  let players = snapshot.players
  let pots = snapshot.pots
  for (const [playerId, delta] of playerDeltas) {
    const player = players.find((p) => p.id === playerId)!
    const stack = player.stack + delta
    if (stack < 0) {
      return err(
        new InvalidAction({
          reason: `correction would make ${player.name}'s stack negative`,
        }),
      )
    }
    players = replacePlayer(players, { ...player, stack: makeChips(stack) })
  }
  for (const [potId, delta] of potDeltas) {
    const pot = pots.find((p) => p.id === potId)!
    const amount = pot.amount + delta
    if (amount < 0) {
      return err(
        new InvalidAction({
          reason: `correction would make ${pot.label} negative`,
        }),
      )
    }
    pots = pots.map((p) =>
      p.id === potId ? { ...p, amount: makeChips(amount) } : p,
    )
  }

  return ok(
    { ...snapshot, players, pots },
    [{ _tag: 'correction-committed', reason, moves }],
  )
}

/**
 * Return a mistaken fold to the hand. The seat leaves `actedSeats` so the
 * street cannot close before they act; if betting had already closed, the
 * turn pointer moves to them.
 */
export function restoreFoldedPlayer(
  snapshot: GameSnapshot,
  seatIndex: number,
): ReducerResult {
  const hand = snapshot.hand
  if (!hand || snapshot.game.status !== 'in-hand') {
    return err(
      new InvalidAction({
        reason: 'restore is only available during betting',
      }),
    )
  }
  const player = snapshot.players.find((p) => p.seatIndex === seatIndex)
  if (!player || player.handStatus !== 'folded') {
    return err(new InvalidAction({ reason: 'player has not folded' }))
  }

  return ok(
    {
      ...snapshot,
      players: replacePlayer(snapshot.players, {
        ...player,
        handStatus: 'waiting',
      }),
      hand: {
        ...hand,
        actedSeats: hand.actedSeats.filter((seat) => seat !== seatIndex),
        activeSeat: hand.activeSeat ?? player.seatIndex,
        nextStreetReady: false,
      },
    },
    [{ _tag: 'folded-player-restored', seatIndex: player.seatIndex }],
  )
}

/** Move the turn pointer to another seat that can still act. */
export function setActivePlayer(
  snapshot: GameSnapshot,
  seatIndex: number,
): ReducerResult {
  const hand = snapshot.hand
  if (!hand || snapshot.game.status !== 'in-hand') {
    return err(new InvalidAction({ reason: 'no active hand' }))
  }
  const player = snapshot.players.find((p) => p.seatIndex === seatIndex)
  const dealtIn = hand.commitments.some((c) => c.seatIndex === seatIndex)
  if (!player || !dealtIn || !isActionable(player)) {
    return err(
      new InvalidAction({ reason: 'that player cannot act in this hand' }),
    )
  }

  return ok(
    {
      ...snapshot,
      hand: { ...hand, activeSeat: player.seatIndex, nextStreetReady: false },
    },
    [{ _tag: 'active-player-set', seatIndex: player.seatIndex }],
  )
}
