import { makeChips } from '../shared/chips'
import { PotId } from '../shared/schema/ids'
import { isLive } from './turn-order'
import type {
  GamePlayer,
  HandId,
  Pot,
  SeatCommitment,
  SeatIndex,
} from './state/types'

export interface UncalledReturn {
  seatIndex: SeatIndex
  amount: number
}

/**
 * The uncalled portion of the highest commitment: whatever the top
 * committer put in beyond what any other player matched returns to them
 * before pots are built (standard poker; Decision Log 2026-07-02 — SPEC
 * does not cover this case explicitly).
 */
export function uncalledExcess(
  commitments: readonly SeatCommitment[],
): UncalledReturn | null {
  const funded = [...commitments]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
  const top = funded[0]
  if (!top) return null
  const secondTotal = funded[1]?.total ?? 0
  if (top.total <= secondTotal) return null
  return { seatIndex: top.seatIndex, amount: top.total - secondTotal }
}

/**
 * Build the ordered pot stack from called commitments (SPEC.md Side Pots,
 * ARCHITECTURE.md Side-Pot Algorithm). Call after uncalled excess has been
 * returned. Bands come from live all-in commitment thresholds; folded
 * players fund every band they reached but are never eligible.
 */
export function buildPots(
  handId: HandId,
  players: readonly GamePlayer[],
  commitments: readonly SeatCommitment[],
): Pot[] {
  const funded = commitments.filter((c) => c.total > 0)
  if (funded.length === 0) return []

  const playerBySeat = new Map<number, GamePlayer>(
    players.map((p) => [p.seatIndex, p]),
  )
  const liveTotals = (seat: number) => {
    const player = playerBySeat.get(seat)
    return player !== undefined && isLive(player)
  }

  const maxTotal = Math.max(...funded.map((c) => c.total))
  const allInCaps = funded
    .filter(
      (c) => playerBySeat.get(c.seatIndex)?.handStatus === 'all-in',
    )
    .map((c) => c.total)
  const bandTops = [...new Set([...allInCaps, maxTotal])]
    .filter((top) => top <= maxTotal)
    .sort((a, b) => a - b)

  const pots: Pot[] = []
  let bottom = 0
  for (const top of bandTops) {
    const amount = funded.reduce(
      (sum, c) => sum + Math.max(0, Math.min(c.total, top) - bottom),
      0,
    )
    if (amount > 0) {
      const contributors = funded.filter((c) => c.total > bottom)
      const eligible = contributors.filter(
        (c) => liveTotals(c.seatIndex) && c.total >= top,
      )
      const index = pots.length
      pots.push({
        id: PotId.make(
          index === 0 ? `pot_${handId}_main` : `pot_${handId}_side${index}`,
        ),
        label: index === 0 ? 'Main Pot' : `Side Pot ${index}`,
        amount: makeChips(amount),
        contributorIds: contributors.map(
          (c) => playerBySeat.get(c.seatIndex)!.id,
        ),
        eligiblePlayerIds: eligible.map(
          (c) => playerBySeat.get(c.seatIndex)!.id,
        ),
        allInThreshold: top < maxTotal ? makeChips(top) : null,
      })
    }
    bottom = top
  }
  return pots
}
