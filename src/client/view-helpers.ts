import type { GamePlayer } from '../shared/schema/snapshot'

export function bySeatOrder(players: readonly GamePlayer[]): GamePlayer[] {
  return [...players].sort((a, b) => a.seatIndex - b.seatIndex)
}

/** Integer cents to a "12.34" money string (money is cents everywhere). */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Signed money for net win/loss columns: "+5.00" / "-5.00" / "0.00". */
export function formatNetCents(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents)
}
