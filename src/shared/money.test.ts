import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { Money, addCents, makeCents } from './money'

describe('cent amounts', () => {
  it('accepts non-negative integer cents', () => {
    expect(makeCents(0)).toBe(0)
    expect(makeCents(1000)).toBe(1000)
  })

  it.each([
    ['negative', -1],
    ['fractional cents', 10.5],
    ['NaN', Number.NaN],
    ['beyond safe range', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s', (_label, value) => {
    expect(() => makeCents(value)).toThrow()
  })

  it('adds cent amounts', () => {
    expect(addCents(makeCents(1000), makeCents(500))).toBe(1500)
  })
})

describe('money values', () => {
  const decode = Schema.decodeUnknownSync(Money)

  it('decodes a valid money value', () => {
    expect(decode({ currency: 'EUR', cents: 1000 })).toEqual({
      currency: 'EUR',
      cents: 1000,
    })
  })

  it.each([
    ['lowercase currency', { currency: 'eur', cents: 1000 }],
    ['long currency', { currency: 'EURO', cents: 1000 }],
    ['fractional cents', { currency: 'EUR', cents: 9.99 }],
    ['negative cents', { currency: 'EUR', cents: -1 }],
  ])('rejects %s', (_label, value) => {
    expect(() => decode(value)).toThrow()
  })
})
