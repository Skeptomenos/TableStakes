import { Schema } from 'effect'

// Money is tracked in integer cents (SPEC.md Buy-Ins section). Chip value is
// a rational ratio derived from buy-ins; no floating-point money anywhere.
export const CentAmount = Schema.Number.pipe(
  Schema.int(),
  Schema.between(0, Number.MAX_SAFE_INTEGER),
  Schema.brand('CentAmount'),
)
export type CentAmount = typeof CentAmount.Type

export const CurrencyCode = Schema.String.pipe(
  Schema.pattern(/^[A-Z]{3}$/),
  Schema.brand('CurrencyCode'),
)
export type CurrencyCode = typeof CurrencyCode.Type

export const Money = Schema.Struct({
  currency: CurrencyCode,
  cents: CentAmount,
})
export type Money = typeof Money.Type

export function makeCents(value: number): CentAmount {
  return CentAmount.make(value)
}

export function addCents(a: CentAmount, b: CentAmount): CentAmount {
  return makeCents(a + b)
}
