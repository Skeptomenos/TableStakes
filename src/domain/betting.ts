import { makeChips } from '../shared/chips'
import type { GamePlayer, HandState, SeatCommitment } from './state/types'

export interface CommitResult {
  player: GamePlayer
  commitment: SeatCommitment
  /** Chips actually moved from stack to street commitment. */
  paid: number
  allIn: boolean
}

/**
 * Move chips so the player's street commitment reaches `betTo` (capped by
 * stack). Pure: returns updated copies. Callers guard legality; this only
 * enforces that chips cannot exceed the stack.
 */
export function commitTo(
  player: GamePlayer,
  commitment: SeatCommitment,
  betTo: number,
): CommitResult {
  const target = Math.min(betTo, commitment.street + player.stack)
  const paid = target - commitment.street
  const stack = makeChips(player.stack - paid)
  const allIn = stack === 0
  return {
    player: {
      ...player,
      stack,
      handStatus: allIn ? 'all-in' : player.handStatus,
    },
    commitment: {
      ...commitment,
      street: makeChips(commitment.street + paid),
      total: makeChips(commitment.total + paid),
    },
    paid,
    allIn,
  }
}

/** Null when the seat is not dealt into the hand (callers return a typed
 * DomainError instead of throwing — reducers never throw). */
export function commitmentFor(
  hand: HandState,
  seatIndex: number,
): SeatCommitment | null {
  return hand.commitments.find((c) => c.seatIndex === seatIndex) ?? null
}

export function replaceCommitment(
  commitments: readonly SeatCommitment[],
  next: SeatCommitment,
): SeatCommitment[] {
  return commitments.map((c) => (c.seatIndex === next.seatIndex ? next : c))
}

export function replacePlayer(
  players: readonly GamePlayer[],
  next: GamePlayer,
): GamePlayer[] {
  return players.map((p) => (p.seatIndex === next.seatIndex ? next : p))
}
