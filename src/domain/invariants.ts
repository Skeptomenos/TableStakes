import type { GameSnapshot } from './state/types'

// Chip conservation: chips exist in stacks, live hand commitments, or pots —
// nowhere else. Reducer transitions must never change this total; only
// buy-ins/rebuys add chips and only cash-out removes them (SPEC.md).
export function totalChipsInPlay(snapshot: GameSnapshot): number {
  const stacks = snapshot.players.reduce(
    (sum, p) => sum + p.stack + p.pendingRebuyChips,
    0,
  )
  const commitments =
    snapshot.hand?.commitments.reduce((sum, c) => sum + c.total, 0) ?? 0
  const pots = snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0)
  return stacks + commitments + pots
}
