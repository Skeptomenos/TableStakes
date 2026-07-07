import { describe, expect, it } from 'vitest'

import { addChips, isChipAmount, makeChips, subtractChips } from './chips'

describe('chip amounts', () => {
  it('accepts non-negative safe integers', () => {
    expect(makeChips(0)).toBe(0)
    expect(makeChips(1000)).toBe(1000)
    expect(makeChips(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['beyond safe range', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s chip values', (_label, value) => {
    expect(() => makeChips(value)).toThrow()
    expect(isChipAmount(value)).toBe(false)
  })

  it('adds chip amounts', () => {
    expect(addChips(makeChips(600), makeChips(400))).toBe(1000)
  })

  it('subtracts chip amounts and refuses to go below zero', () => {
    expect(subtractChips(makeChips(1000), makeChips(400))).toBe(600)
    expect(() => subtractChips(makeChips(400), makeChips(1000))).toThrow()
  })
})
