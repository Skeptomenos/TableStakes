import type { GamePlayer } from './state/types'

// Seat iteration in clockwise order. Player arrays may have sparse seat
// indexes; all iteration sorts by seatIndex and wraps around the table.

export function bySeat(players: readonly GamePlayer[]): GamePlayer[] {
  return [...players].sort((a, b) => a.seatIndex - b.seatIndex)
}

/**
 * Players in clockwise order starting AFTER the given seat (exclusive),
 * wrapping around the table. `fromSeat` itself comes last.
 */
export function seatsAfter(
  players: readonly GamePlayer[],
  fromSeat: number,
): GamePlayer[] {
  const sorted = bySeat(players)
  const after = sorted.filter((p) => p.seatIndex > fromSeat)
  const before = sorted.filter((p) => p.seatIndex <= fromSeat)
  return [...after, ...before]
}

export function nextSeatWhere(
  players: readonly GamePlayer[],
  fromSeat: number,
  predicate: (player: GamePlayer) => boolean,
): GamePlayer | null {
  return seatsAfter(players, fromSeat).find(predicate) ?? null
}

// Eligible to be dealt into the next hand: has chips, is not sitting out,
// and has not had the seat released. A returning sit-out player (flag
// cleared) is dealt in with no penalty. Released seats keep their chips on
// the table but are skipped like sit-outs until the profile reclaims the
// seat — otherwise a departed player posts blinds forever (Slice 12, from
// the Slice 10 dogfood). Interrupted/reserved seats stay dealt in: those
// players are expected back (SPEC.md: no timeout-based exclusion).
export function canDealIn(player: GamePlayer): boolean {
  return (
    player.stack > 0 &&
    !player.sitOutNextHand &&
    player.connection !== 'released'
  )
}

// Can still take normal actions in the current hand.
export function isActionable(player: GamePlayer): boolean {
  return player.handStatus === 'waiting' || player.handStatus === 'active'
}

// Still contesting the hand (eligible to win a pot).
export function isLive(player: GamePlayer): boolean {
  return isActionable(player) || player.handStatus === 'all-in'
}
