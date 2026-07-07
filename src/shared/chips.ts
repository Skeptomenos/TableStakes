import { Schema } from 'effect'

// Chips are always non-negative safe integers. Every stack, pot, bet, and
// commitment in the app uses this brand so fractional or negative chip
// values cannot cross any boundary.
export const ChipAmount = Schema.Number.pipe(
  Schema.int(),
  Schema.between(0, Number.MAX_SAFE_INTEGER),
  Schema.brand('ChipAmount'),
)
export type ChipAmount = typeof ChipAmount.Type

export function makeChips(value: number): ChipAmount {
  return ChipAmount.make(value)
}

export function isChipAmount(value: number): boolean {
  return Schema.is(ChipAmount)(value)
}

export function addChips(a: ChipAmount, b: ChipAmount): ChipAmount {
  return makeChips(a + b)
}

export function subtractChips(a: ChipAmount, b: ChipAmount): ChipAmount {
  if (b > a) {
    throw new RangeError(`chip subtraction below zero: ${a} - ${b}`)
  }
  return makeChips(a - b)
}
