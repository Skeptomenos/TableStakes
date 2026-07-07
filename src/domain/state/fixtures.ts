import { Schema } from 'effect'

import {
  GamePlayer,
  GameSettings,
  GameSnapshot,
} from '../../shared/schema/snapshot'

// Deterministic fixture builders for domain tests: fixed ids, fixed
// timestamps, no randomness (TESTING.md: explicit fixtures over random
// table state). Built through Schema decode so every fixture is guaranteed
// schema-valid and correctly branded.

const FIXED_TIMESTAMP = 1_780_000_000_000

const decodeSettings = Schema.decodeUnknownSync(GameSettings)
const decodePlayer = Schema.decodeUnknownSync(GamePlayer)
const decodeSnapshot = Schema.decodeUnknownSync(GameSnapshot)

type SettingsOverrides = Partial<typeof GameSettings.Encoded>
type PlayerOverrides = Partial<typeof GamePlayer.Encoded>

// SPEC.md example economy: 10 EUR = 1000 chips, blinds 50/100.
export function makeTestSettings(
  overrides: SettingsOverrides = {},
): GameSettings {
  return decodeSettings({
    currency: 'EUR',
    defaultBuyInCents: 1000,
    defaultStack: 1000,
    smallBlind: 50,
    bigBlind: 100,
    strictMode: false,
    raiseRule: 'any',
    amountStep: { kind: 'follow-small-blind' },
    ...overrides,
  })
}

export function makeTestPlayer(
  seatIndex: number,
  overrides: PlayerOverrides = {},
): GamePlayer {
  return decodePlayer({
    id: `player_s${seatIndex}`,
    profileId: `profile_s${seatIndex}`,
    name: `Player ${seatIndex + 1}`,
    seatIndex,
    stack: 1000,
    handStatus: 'waiting',
    connection: 'connected',
    sitOutNextHand: false,
    totalBuyInCents: 1000,
    totalChipsPurchased: 1000,
    pendingRebuyChips: 0,
    ...overrides,
  })
}

export interface SetupSnapshotOptions {
  playerCount: number
  settings?: GameSettings
}

export function makeSetupSnapshot(
  options: SetupSnapshotOptions,
): GameSnapshot {
  const settings = options.settings ?? makeTestSettings()
  const players = Array.from({ length: options.playerCount }, (_, seat) =>
    makeTestPlayer(seat),
  )
  return decodeSnapshot({
    game: {
      id: 'game_test',
      code: '48317',
      status: 'setup',
      settings,
      creatorProfileId: 'profile_s0',
      dealerSeat: 0,
      pendingSettings: null,
      lastHandNumber: 0,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    },
    players,
    hand: null,
    pots: [],
    eventCursor: 0,
  })
}

export interface BetweenHandsOptions {
  playerCount: number
  dealerSeat?: number
  settings?: GameSettings
  /** Per-seat overrides applied on top of the default player fixture. */
  playerOverrides?: Record<number, PlayerOverrides>
}

// A game that finished setup and is ready to start the next hand.
export function makeBetweenHandsSnapshot(
  options: BetweenHandsOptions,
): GameSnapshot {
  const base = makeSetupSnapshot({
    playerCount: options.playerCount,
    settings: options.settings,
  })
  const players = base.players.map((player) =>
    options.playerOverrides?.[player.seatIndex]
      ? makeTestPlayer(player.seatIndex, options.playerOverrides[player.seatIndex])
      : player,
  )
  return decodeSnapshot({
    ...base,
    game: {
      ...base.game,
      status: 'between-hands',
      dealerSeat: options.dealerSeat ?? 0,
    },
    players,
  })
}
