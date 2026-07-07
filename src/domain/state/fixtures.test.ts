import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { GameSnapshot } from '../../shared/schema/snapshot'
import { makeSetupSnapshot, makeTestPlayer, makeTestSettings } from './fixtures'

const validate = Schema.decodeUnknownSync(GameSnapshot)

describe('deterministic fixtures', () => {
  it('builds schema-valid setup snapshots for 2 to 10 players', () => {
    for (const count of [2, 6, 10]) {
      const snapshot = makeSetupSnapshot({ playerCount: count })
      expect(snapshot.players).toHaveLength(count)
      expect(() => validate(snapshot)).not.toThrow()
    }
  })

  it('is deterministic: same inputs produce identical snapshots', () => {
    expect(makeSetupSnapshot({ playerCount: 4 })).toEqual(
      makeSetupSnapshot({ playerCount: 4 }),
    )
  })

  it('applies overrides without breaking schema validity', () => {
    const settings = makeTestSettings({ smallBlind: 25, bigBlind: 50 })
    expect(settings.smallBlind).toBe(25)

    const player = makeTestPlayer(3, { stack: 500 })
    expect(player.seatIndex).toBe(3)
    expect(player.stack).toBe(500)

    const snapshot = makeSetupSnapshot({ playerCount: 2, settings })
    expect(() => validate(snapshot)).not.toThrow()
    expect(snapshot.game.settings.smallBlind).toBe(25)
  })

  it('defaults to the SPEC example economy: 10 EUR = 1000 chips', () => {
    const settings = makeTestSettings()
    expect(settings.currency).toBe('EUR')
    expect(settings.defaultBuyInCents).toBe(1000)
    expect(settings.defaultStack).toBe(1000)
  })
})
