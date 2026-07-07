import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { GameCode, GameId, ProfileId } from './ids'

describe('game codes', () => {
  const decode = Schema.decodeUnknownSync(GameCode)

  it('accepts a five-digit numeric code', () => {
    expect(decode('48317')).toBe('48317')
    expect(decode('00001')).toBe('00001')
  })

  it.each([
    ['too short', '4831'],
    ['too long', '483170'],
    ['alphabetic', 'ABCDE'],
    ['mixed', '1234a'],
    ['stale alphanumeric Stitch format', 'A7B29'],
    ['empty', ''],
    ['number instead of string', 48317],
  ])('rejects %s game codes', (_label, value) => {
    expect(() => decode(value)).toThrow()
  })
})

describe('entity ids', () => {
  it('rejects empty id strings', () => {
    expect(() => Schema.decodeUnknownSync(GameId)('')).toThrow()
    expect(() => Schema.decodeUnknownSync(ProfileId)('')).toThrow()
  })

  it('accepts non-empty id strings', () => {
    expect(Schema.decodeUnknownSync(GameId)('game_1')).toBe('game_1')
  })
})
