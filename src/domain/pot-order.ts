import type { Pot } from './state/types'

// Settlement strictly follows display order: main pot, side pot 1, side
// pot 2, ... (SPEC.md Hand Settlement). Settled pots are removed, so the
// first pot in the array is always the next one to settle.

export function firstUnresolvedPot(pots: readonly Pot[]): Pot | null {
  return pots[0] ?? null
}

export function isEligibleForAllPots(
  pots: readonly Pot[],
  playerId: string,
): boolean {
  return (
    pots.length > 0 &&
    pots.every((pot) => pot.eligiblePlayerIds.some((id) => id === playerId))
  )
}
