import type { GameSettings, RaiseRule } from './state/types'

// Raise minimums per game setting (SPEC.md Raise Rules, ADR 0001 amendment).
// All amounts are street bet-to totals, not increments.

/** Chip step for slider/plus-minus and the `any` rule suggestion. */
export function resolveStep(settings: GameSettings): number {
  switch (settings.amountStep.kind) {
    case 'fixed':
      return Math.max(1, settings.amountStep.chips)
    case 'follow-small-blind':
      return Math.max(1, settings.smallBlind)
    case 'follow-big-blind':
      return Math.max(1, settings.bigBlind)
  }
}

/** Minimum (or suggested) opening bet when nothing has been bet yet. */
export function minOpeningBet(rule: RaiseRule, settings: GameSettings): number {
  switch (rule) {
    case 'any':
      // Suggested minimum: call amount (0) plus one chip step.
      return resolveStep(settings)
    case 'double':
    case 'standard':
      // Minimum opening bet is one big blind.
      return settings.bigBlind
  }
}

/**
 * Minimum legal/suggested raise target given the current street state.
 * `lastRaiseSize` is the size of the last full bet or raise on the street.
 */
export function minRaiseTo(
  rule: RaiseRule,
  currentBet: number,
  lastRaiseSize: number,
  settings: GameSettings,
): number {
  if (currentBet === 0) {
    return minOpeningBet(rule, settings)
  }
  switch (rule) {
    case 'any':
      return currentBet + resolveStep(settings)
    case 'double':
      return currentBet * 2
    case 'standard':
      return currentBet + Math.max(lastRaiseSize, settings.bigBlind)
  }
}
