/**
 * Pure chop-selection allocation engine (ADR 0003 Decision 1, DESIGN.md
 * Hand Settlement). No React, no domain imports — a plain function of
 * (amount, selected seats, dealer seat) so the odd-chip rule and the
 * zero-sum adjustment step are unit-pinned independent of any component.
 */

export interface SplitSeat {
  playerId: string
  seatIndex: number
}

/**
 * Evenly splits `amount` across `selected` players. The integer remainder
 * (amount % selected.length) is handed out one chip at a time to the
 * selected players in seat order, starting from the earliest selected seat
 * strictly after `dealerSeat` and wrapping around the table if no selected
 * seat comes after the dealer.
 */
export function evenSplit(
  amount: number,
  selected: readonly SplitSeat[],
  dealerSeat: number,
): Record<string, number> {
  const result: Record<string, number> = {}
  if (selected.length === 0) return result

  const base = Math.floor(amount / selected.length)
  // remainder < selected.length by construction (amount % n), so the loop
  // below touches each seat at most once.
  const remainder = amount - base * selected.length

  const ordered = [...selected].sort((a, b) => a.seatIndex - b.seatIndex)
  const startIndex = ordered.findIndex((s) => s.seatIndex > dealerSeat)
  const rotation =
    startIndex === -1
      ? ordered
      : [...ordered.slice(startIndex), ...ordered.slice(0, startIndex)]

  for (const seat of ordered) result[seat.playerId] = base
  for (let i = 0; i < remainder; i++) {
    const seat = rotation[i % rotation.length]!
    result[seat.playerId]! += 1
  }

  return result
}

/**
 * Zero-sum adjustment: moves `delta` steps (each of size `step`) onto
 * `targetPlayerId`'s share, pulling the equivalent chips from whichever
 * OTHER selected player currently holds the largest share (re-evaluated
 * each step, so a run of adjust calls always drains the current largest,
 * not a stale one). A negative delta pushes chips OFF the target and onto
 * the current largest other share instead. Every step floors its donor at
 * 0 and no-ops when no other share has chips left to give (increase) or
 * the target itself is already at 0 (decrease).
 */
export function adjust(
  allocations: Record<string, number>,
  targetPlayerId: string,
  delta: number,
  step: number,
): Record<string, number> {
  let current = { ...allocations }
  const steps = Math.abs(delta)
  const sign = delta >= 0 ? 1 : -1

  for (let i = 0; i < steps; i++) {
    if (sign > 0) {
      const donorId = largestOtherShare(current, targetPlayerId)
      if (donorId === null) break // nothing left to give
      const move = Math.min(step, current[donorId]!)
      if (move <= 0) break
      current = {
        ...current,
        [targetPlayerId]: current[targetPlayerId]! + move,
        [donorId]: current[donorId]! - move,
      }
    } else {
      if (current[targetPlayerId]! <= 0) break // nothing left to take
      const move = Math.min(step, current[targetPlayerId]!)
      // A RECEIVER at 0 is fine — only donors need chips. Without this,
      // pulling the whole pot onto one player dead-ended the − stepper
      // (FINAL-verification finding).
      const receiverId =
        largestOtherShare(current, targetPlayerId) ??
        anyOtherPlayer(current, targetPlayerId)
      if (receiverId === null) break
      current = {
        ...current,
        [targetPlayerId]: current[targetPlayerId]! - move,
        [receiverId]: current[receiverId]! + move,
      }
    }
  }

  return current
}

/** First other player regardless of share — the decrease-receiver fallback. */
function anyOtherPlayer(
  allocations: Record<string, number>,
  excludeId: string,
): string | null {
  for (const playerId of Object.keys(allocations)) {
    if (playerId !== excludeId) return playerId
  }
  return null
}

/** The playerId (other than `excludeId`) with the largest current share. */
function largestOtherShare(
  allocations: Record<string, number>,
  excludeId: string,
): string | null {
  let bestId: string | null = null
  let bestShare = -1
  for (const [playerId, share] of Object.entries(allocations)) {
    if (playerId === excludeId) continue
    if (share > bestShare) {
      bestShare = share
      bestId = playerId
    }
  }
  return bestId !== null && bestShare > 0 ? bestId : null
}
