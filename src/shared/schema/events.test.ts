import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { EventEnvelope } from './events'

const decode = Schema.decodeUnknownSync(EventEnvelope)

const envelope = (event: unknown, overrides: Record<string, unknown> = {}) => ({
  id: 'evt_1',
  gameId: 'game_1',
  handId: 'hand_1',
  visibleTransactionId: 'vtx_1',
  actorProfileId: 'profile_1',
  timestamp: 1_780_000_000_000,
  event,
  ...overrides,
})

describe('event envelope', () => {
  it('decodes a valid blind-posted event', () => {
    const decoded = decode(
      envelope({ _tag: 'blind-posted', seatIndex: 2, kind: 'small', amount: 50 }),
    )
    expect(decoded.event._tag).toBe('blind-posted')
  })

  it('decodes lifecycle events without a hand id', () => {
    expect(() =>
      decode(
        envelope(
          { _tag: 'game-created', code: '48317', creatorProfileId: 'profile_1' },
          { handId: null },
        ),
      ),
    ).not.toThrow()
  })

  it('rejects unknown event tags', () => {
    expect(() => decode(envelope({ _tag: 'cards-dealt' }))).toThrow()
  })

  it('rejects street-advanced with an invalid street', () => {
    expect(() =>
      decode(envelope({ _tag: 'street-advanced', street: 'ocean' })),
    ).toThrow()
    expect(() =>
      decode(envelope({ _tag: 'street-advanced', street: 'flop' })),
    ).not.toThrow()
  })

  it('rejects envelopes missing the visible transaction id', () => {
    expect(() =>
      decode({
        id: 'evt_1',
        gameId: 'game_1',
        handId: null,
        actorProfileId: null,
        timestamp: 1_780_000_000_000,
        event: { _tag: 'checked', seatIndex: 1 },
      }),
    ).toThrow()
  })

  it('rejects non-integer timestamps', () => {
    expect(() =>
      decode(
        envelope({ _tag: 'checked', seatIndex: 1 }, { timestamp: 17.5 }),
      ),
    ).toThrow()
  })
})
