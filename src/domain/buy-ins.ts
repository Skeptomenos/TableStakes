import { Schema } from 'effect'

import { makeChips } from '../shared/chips'
import { makeCents, Money } from '../shared/money'
import { replacePlayer } from './betting'
import { err, ok, type ReducerResult } from './result'
import { InvalidAction } from './state/errors'
import type { GamePlayer, GameSnapshot } from './state/types'

export interface MoneyInput {
  currency: string
  cents: number
}

const isMoney = Schema.is(Money)
const decodeMoney = Schema.decodeUnknownSync(Money)

export function validateMoney(
  snapshot: GameSnapshot,
  money: MoneyInput,
  chips: number,
): ReducerResult | null {
  if (!isMoney(money)) {
    return err(new InvalidAction({ reason: 'invalid money amount' }))
  }
  if (money.currency !== snapshot.game.settings.currency) {
    return err(
      new InvalidAction({
        reason: `game currency is ${snapshot.game.settings.currency}`,
      }),
    )
  }
  if (!Number.isSafeInteger(chips) || chips <= 0) {
    return err(new InvalidAction({ reason: 'chips must be a positive integer' }))
  }
  return null
}

/** Clear a zero-chip marker once the player has chips again. */
export function statusAfterChipsAdded(
  player: GamePlayer,
): GamePlayer['handStatus'] {
  if (player.handStatus !== 'needs-rebuy') return player.handStatus
  return player.sitOutNextHand ? 'sitting-out' : 'waiting'
}

/**
 * Record a buy-in: money in, chips onto the stack. Buy-ins happen in setup
 * or between hands; chips enter play only here and through rebuys.
 */
export function recordBuyIn(
  snapshot: GameSnapshot,
  playerIdRaw: string,
  money: MoneyInput,
  chips: number,
): ReducerResult {
  if (
    snapshot.game.status !== 'setup' &&
    snapshot.game.status !== 'between-hands'
  ) {
    return err(
      new InvalidAction({ reason: 'buy-ins happen in setup or between hands' }),
    )
  }
  const invalid = validateMoney(snapshot, money, chips)
  if (invalid) return invalid

  const player = snapshot.players.find((p) => p.id === playerIdRaw)
  if (!player) {
    return err(new InvalidAction({ reason: 'unknown player for buy-in' }))
  }

  // ADR 0002: a player's FIRST buy-in must equal the table default
  // exactly (money and chips) — everyone starts equal, one tap, no
  // variance. `totalChipsPurchased === 0` tells a never-bought-in player
  // from later top-ups. A direct second-or-later recordBuyIn call (the
  // usual path for later top-ups is record-rebuy, capped identically) is
  // still capped at the default rather than left open — "chips enter at
  // most default-sized" holds through every entry point.
  const { defaultBuyInCents, defaultStack } = snapshot.game.settings
  if (player.totalChipsPurchased === 0) {
    if (money.cents !== defaultBuyInCents || chips !== defaultStack) {
      return err(
        new InvalidAction({
          reason: `first buy-in must be the table default (${defaultBuyInCents} cents / ${defaultStack} chips)`,
        }),
      )
    }
  } else if (money.cents > defaultBuyInCents || chips > defaultStack) {
    return err(
      new InvalidAction({
        reason: `buy-in is capped at the table default (${defaultBuyInCents} cents / ${defaultStack} chips)`,
      }),
    )
  }

  const next: GamePlayer = {
    ...player,
    stack: makeChips(player.stack + chips),
    totalBuyInCents: makeCents(player.totalBuyInCents + money.cents),
    totalChipsPurchased: makeChips(player.totalChipsPurchased + chips),
  }

  return ok(
    {
      ...snapshot,
      players: replacePlayer(snapshot.players, {
        ...next,
        handStatus: statusAfterChipsAdded(next),
      }),
    },
    [
      {
        _tag: 'buy-in-recorded',
        playerId: player.id,
        money: decodeMoney(money),
        chips: makeChips(chips),
      },
    ],
  )
}
