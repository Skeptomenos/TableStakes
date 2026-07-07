import type { Street } from './state/types'

export const STREET_ORDER: readonly Street[] = [
  'pre-flop',
  'flop',
  'turn',
  'river',
  'showdown',
]

export function nextStreet(street: Street): Street | null {
  const index = STREET_ORDER.indexOf(street)
  const next = STREET_ORDER[index + 1]
  return next ?? null
}
