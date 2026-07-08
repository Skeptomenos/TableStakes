import { describe, expect, it } from 'vitest'

import { recordBuyIn } from './buy-ins'
import { recordRebuy } from './rebuy'
import {
  makeBetweenHandsSnapshot,
  makeSetupSnapshot,
  makeTestSettings,
} from './state/fixtures'
import { mustOk } from './testing'
import type { GameSnapshot } from './state/types'

function playerId(s: GameSnapshot, seatIndex: number): string {
  return s.players.find((p) => p.seatIndex === seatIndex)!.id
}

// ADR 0002 money rules (domain-enforced, new): a first buy-in must equal
// the table default exactly, and a rebuy is capped at the default. Both
// are red today — recordBuyIn/recordRebuy only validate positive amounts.

describe('first buy-in must equal the table default (ADR 0002)', () => {
  it('rejects a first buy-in above the default (money and chips)', () => {
    const s = makeBetweenHandsSnapshot({
      playerCount: 2,
      playerOverrides: {
        0: { stack: 0, totalBuyInCents: 0, totalChipsPurchased: 0, handStatus: 'needs-rebuy' },
      },
    })
    // Table default is 10 EUR = 1000 chips (makeTestSettings); this player
    // has never bought in (totalChipsPurchased === 0).
    const result = recordBuyIn(
      s,
      playerId(s, 0),
      { currency: 'EUR', cents: 2000 },
      2000,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toMatch(/default/i)
    }
  })

  it('rejects a first buy-in below the default (money and chips)', () => {
    const s = makeBetweenHandsSnapshot({
      playerCount: 2,
      playerOverrides: {
        0: { stack: 0, totalBuyInCents: 0, totalChipsPurchased: 0, handStatus: 'needs-rebuy' },
      },
    })
    const result = recordBuyIn(
      s,
      playerId(s, 0),
      { currency: 'EUR', cents: 500 },
      500,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toMatch(/default/i)
    }
  })

  it('rejects a first buy-in whose CHIPS alone differ from the default (money exact)', () => {
    // Same single-operand pin for the equality gate: money right, chips
    // wrong must still be rejected.
    const s = makeBetweenHandsSnapshot({
      playerCount: 2,
      playerOverrides: {
        0: { stack: 0, totalBuyInCents: 0, totalChipsPurchased: 0, handStatus: 'needs-rebuy' },
      },
    })
    const result = recordBuyIn(
      s,
      playerId(s, 0),
      { currency: 'EUR', cents: 1000 },
      1500,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toMatch(/default/i)
    }
  })

  it('accepts a first buy-in that matches the default exactly', () => {
    const s = makeBetweenHandsSnapshot({
      playerCount: 2,
      playerOverrides: {
        0: { stack: 0, totalBuyInCents: 0, totalChipsPurchased: 0, handStatus: 'needs-rebuy' },
      },
    })
    const result = mustOk(
      recordBuyIn(s, playerId(s, 0), { currency: 'EUR', cents: 1000 }, 1000),
      'default first buy-in',
    )
    const player = result.snapshot.players.find((p) => p.seatIndex === 0)!
    expect(player.stack).toBe(1000)
  })

  it('allows a SECOND direct recordBuyIn call at exactly the default (totalChipsPurchased already > 0)', () => {
    // Fixture default player already has totalChipsPurchased: 1000 (one
    // buy-in on record) — the exact-equality gate only applies to the
    // FIRST buy-in (totalChipsPurchased === 0). A later direct recordBuyIn
    // call is unusual in the new choreography (later top-ups go through
    // record-rebuy) but still allowed up to the default (see next test).
    const s = makeSetupSnapshot({ playerCount: 2 })
    const result = mustOk(
      recordBuyIn(s, playerId(s, 0), { currency: 'EUR', cents: 1000 }, 1000),
      'second buy-in',
    )
    expect(result.snapshot.players.find((p) => p.seatIndex === 0)!.stack).toBe(2000)
  })

  it('caps a SECOND direct recordBuyIn call at the default too — "chips enter at most default-sized" holds through every entry point', () => {
    const s = makeSetupSnapshot({ playerCount: 2 })
    const result = recordBuyIn(
      s,
      playerId(s, 0),
      { currency: 'EUR', cents: 2000 },
      2000,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toMatch(/cap/i)
    }
  })
})

describe('rebuy is capped at the table default (ADR 0002)', () => {
  it('rejects a rebuy above the default in cents', () => {
    const s = makeBetweenHandsSnapshot({
      playerCount: 3,
      playerOverrides: { 1: { stack: 0, handStatus: 'needs-rebuy' } },
    })
    const result = recordRebuy(
      s,
      playerId(s, 1),
      { currency: 'EUR', cents: 1500 },
      1500,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toMatch(/cap/i)
    }
  })

  it('rejects a rebuy above the default in chips even if money matches the ratio', () => {
    const s = makeBetweenHandsSnapshot({
      playerCount: 3,
      settings: makeTestSettings({ defaultBuyInCents: 1000, defaultStack: 1000 }),
      playerOverrides: { 1: { stack: 0, handStatus: 'needs-rebuy' } },
    })
    const result = recordRebuy(
      s,
      playerId(s, 1),
      { currency: 'EUR', cents: 1001 },
      1001,
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a rebuy whose CHIPS alone exceed the default (money at the cap)', () => {
    // FINAL-verification finding: every earlier reject case raised cents
    // and chips together, so deleting only the chips half of the cap
    // (`chips > defaultStack`) survived the suite. Pin each operand alone.
    const s = makeBetweenHandsSnapshot({
      playerCount: 3,
      playerOverrides: { 1: { stack: 0, handStatus: 'needs-rebuy' } },
    })
    const result = recordRebuy(
      s,
      playerId(s, 1),
      { currency: 'EUR', cents: 1000 },
      1500,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toMatch(/cap/i)
    }
  })

  it('accepts a full rebuy at exactly the default', () => {
    const s = makeBetweenHandsSnapshot({
      playerCount: 3,
      playerOverrides: { 1: { stack: 0, handStatus: 'needs-rebuy' } },
    })
    const result = mustOk(
      recordRebuy(s, playerId(s, 1), { currency: 'EUR', cents: 1000 }, 1000),
      'full rebuy',
    )
    expect(result.snapshot.players.find((p) => p.seatIndex === 1)!.stack).toBe(1000)
  })

  it('accepts a half rebuy (below the default) — quick-pick amounts stay green', () => {
    const s = makeBetweenHandsSnapshot({
      playerCount: 3,
      playerOverrides: { 1: { stack: 0, handStatus: 'needs-rebuy' } },
    })
    const result = mustOk(
      recordRebuy(s, playerId(s, 1), { currency: 'EUR', cents: 500 }, 500),
      'half rebuy',
    )
    expect(result.snapshot.players.find((p) => p.seatIndex === 1)!.stack).toBe(500)
  })
})
