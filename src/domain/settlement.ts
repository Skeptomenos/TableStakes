import { makeChips } from '../shared/chips'
import { replacePlayer } from './betting'
import { firstUnresolvedPot, isEligibleForAllPots } from './pot-order'
import { closeHand } from './reducers/hand-reducer'
import { err, ok, type ReducerResult } from './result'
import { InvalidAction, PotAllocationMismatch } from './state/errors'
import type {
  GameEvent,
  GamePlayer,
  GameSnapshot,
  HandState,
  Pot,
} from './state/types'

export interface SplitAllocationInput {
  playerId: string
  chips: number
}

/** Live remaining-unallocated feedback for the split UI (SPEC.md). */
export function remainingUnallocated(
  pot: Pot,
  allocations: readonly SplitAllocationInput[],
): number {
  return pot.amount - allocations.reduce((sum, a) => sum + a.chips, 0)
}

interface SettlementContext {
  hand: HandState
  pot: Pot
}

function guardSettlement(
  snapshot: GameSnapshot,
  potIdRaw: string,
): SettlementContext | ReducerResult {
  if (snapshot.game.status !== 'showdown' || !snapshot.hand) {
    return err(new InvalidAction({ reason: 'no showdown to settle' }))
  }
  const pot = firstUnresolvedPot(snapshot.pots)
  if (!pot) {
    return err(new InvalidAction({ reason: 'no unresolved pots' }))
  }
  if (pot.id !== potIdRaw) {
    return err(
      new InvalidAction({
        reason: `pots settle in display order; next is ${pot.label}`,
      }),
    )
  }
  return { hand: snapshot.hand, pot }
}

function settleRest(
  snapshot: GameSnapshot,
  hand: HandState,
  remaining: readonly Pot[],
  events: GameEvent[],
): ReducerResult {
  if (remaining.length > 0) {
    return ok({ ...snapshot, pots: [...remaining] }, events)
  }
  return ok(closeHand({ ...snapshot, pots: [] }, hand), [
    ...events,
    { _tag: 'hand-settled' },
  ])
}

/** Award the next unresolved pot to one eligible winner. */
export function awardPot(
  snapshot: GameSnapshot,
  potIdRaw: string,
  winnerIdRaw: string,
): ReducerResult {
  const context = guardSettlement(snapshot, potIdRaw)
  if ('ok' in context) return context
  const { hand, pot } = context

  const winner = snapshot.players.find((p) => p.id === winnerIdRaw)
  if (!winner || !pot.eligiblePlayerIds.some((id) => id === winner.id)) {
    return err(
      new InvalidAction({ reason: `winner is not eligible for ${pot.label}` }),
    )
  }

  const players = replacePlayer(snapshot.players, {
    ...winner,
    stack: makeChips(winner.stack + pot.amount),
  })
  return settleRest(
    { ...snapshot, players },
    hand,
    snapshot.pots.slice(1),
    [{ _tag: 'pot-awarded', potId: pot.id, winnerId: winner.id, amount: pot.amount }],
  )
}

/**
 * Split the next unresolved pot with exact chip amounts. Commit is only
 * possible when the remaining unallocated amount is zero.
 */
export function splitPot(
  snapshot: GameSnapshot,
  potIdRaw: string,
  allocations: readonly SplitAllocationInput[],
): ReducerResult {
  const context = guardSettlement(snapshot, potIdRaw)
  if ('ok' in context) return context
  const { hand, pot } = context

  if (allocations.length === 0) {
    return err(new InvalidAction({ reason: 'split needs at least one allocation' }))
  }

  const recipients: { player: GamePlayer; chips: number }[] = []
  for (const allocation of allocations) {
    const player = snapshot.players.find((p) => p.id === allocation.playerId)
    if (
      !player ||
      !pot.eligiblePlayerIds.some((id) => id === player.id) ||
      allocation.chips <= 0
    ) {
      return err(
        new InvalidAction({
          reason: `invalid split allocation for ${pot.label}`,
        }),
      )
    }
    recipients.push({ player, chips: allocation.chips })
  }

  const allocated = recipients.reduce((sum, r) => sum + r.chips, 0)
  if (allocated !== pot.amount) {
    return err(
      new PotAllocationMismatch({
        potId: pot.id,
        potAmount: pot.amount,
        allocated,
      }),
    )
  }

  let players = snapshot.players
  for (const { player, chips } of recipients) {
    const current = players.find((p) => p.id === player.id)!
    players = replacePlayer(players, {
      ...current,
      stack: makeChips(current.stack + chips),
    })
  }

  return settleRest(
    { ...snapshot, players },
    hand,
    snapshot.pots.slice(1),
    [
      {
        _tag: 'pot-split',
        potId: pot.id,
        allocations: recipients.map((r) => ({
          playerId: r.player.id,
          chips: makeChips(r.chips),
        })),
      },
    ],
  )
}

/**
 * Settle every unresolved pot to one winner in display order. Only legal
 * when that winner is eligible for every unresolved pot (SPEC.md).
 */
export function takeAllEligiblePots(
  snapshot: GameSnapshot,
  winnerIdRaw: string,
): ReducerResult {
  if (snapshot.game.status !== 'showdown' || !snapshot.hand) {
    return err(new InvalidAction({ reason: 'no showdown to settle' }))
  }
  const winner = snapshot.players.find((p) => p.id === winnerIdRaw)
  if (!winner || !isEligibleForAllPots(snapshot.pots, winner.id)) {
    return err(
      new InvalidAction({
        reason: 'winner must be eligible for every unresolved pot',
      }),
    )
  }

  const total = snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0)
  const events: GameEvent[] = snapshot.pots.map((pot) => ({
    _tag: 'pot-awarded',
    potId: pot.id,
    winnerId: winner.id,
    amount: pot.amount,
  }))
  const players = replacePlayer(snapshot.players, {
    ...winner,
    stack: makeChips(winner.stack + total),
  })

  return settleRest({ ...snapshot, players }, snapshot.hand, [], events)
}
