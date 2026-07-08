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

/**
 * Whole-currency-unit amount for the money-to-chip ratio line (SPEC.md,
 * DESIGN.md: `10 EUR = 1000 chips`, not `10.00 EUR = 1000 chips`). Drops
 * the decimal for whole amounts; keeps it for fractional cents.
 */
export function formatMoneyUnits(cents: number): string {
  const units = cents / 100
  return Number.isInteger(units) ? String(units) : units.toFixed(2)
}
