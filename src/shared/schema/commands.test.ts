import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { CommandEnvelope } from './commands'

const decode = Schema.decodeUnknownSync(CommandEnvelope)

const envelope = (command: unknown) => ({
  id: 'cmd_1',
  gameId: 'game_1',
  actorProfileId: 'profile_1',
  command,
})

describe('command envelope', () => {
  it('decodes a valid bet command', () => {
    const decoded = decode(envelope({ _tag: 'bet', amount: 600 }))
    expect(decoded.command).toEqual({ _tag: 'bet', amount: 600 })
  })

  it('decodes seat and settlement commands', () => {
    expect(() =>
      decode(envelope({ _tag: 'claim-seat', seatIndex: 3, profileId: 'profile_1' })),
    ).not.toThrow()
    expect(() =>
      decode(envelope({ _tag: 'award-pot', potId: 'pot_main', winnerId: 'player_1' })),
    ).not.toThrow()
  })

  it('rejects unknown command tags', () => {
    expect(() => decode(envelope({ _tag: 'deal-cards' }))).toThrow()
  })

  it('rejects bet commands with invalid amounts', () => {
    expect(() => decode(envelope({ _tag: 'bet', amount: -5 }))).toThrow()
    expect(() => decode(envelope({ _tag: 'bet', amount: 10.5 }))).toThrow()
  })

  it('rejects split allocations that are empty or non-positive', () => {
    expect(() =>
      decode(envelope({ _tag: 'split-pot', potId: 'pot_main', allocations: [] })),
    ).toThrow()
    expect(() =>
      decode(
        envelope({
          _tag: 'split-pot',
          potId: 'pot_main',
          allocations: [{ playerId: 'player_1', chips: 0 }],
        }),
      ),
    ).toThrow()
  })

  it('rejects corrections whose stack moves are not zero-sum', () => {
    expect(() =>
      decode(
        envelope({
          _tag: 'apply-correction',
          reason: 'misclick',
          moves: [
            { target: { kind: 'player-stack', playerId: 'player_1' }, delta: 100 },
            { target: { kind: 'pot', potId: 'pot_main' }, delta: -50 },
          ],
        }),
      ),
    ).toThrow()
    expect(() =>
      decode(
        envelope({
          _tag: 'apply-correction',
          reason: 'misclick',
          moves: [
            { target: { kind: 'player-stack', playerId: 'player_1' }, delta: 100 },
            { target: { kind: 'pot', potId: 'pot_main' }, delta: -100 },
          ],
        }),
      ),
    ).not.toThrow()
  })

  it('rejects envelopes without a game id', () => {
    expect(() =>
      decode({ id: 'cmd_1', actorProfileId: 'profile_1', command: { _tag: 'check' } }),
    ).toThrow()
  })
})
