import { Schema } from 'effect'

import { makeChips } from '../shared/chips'
import { makeCents, Money } from '../shared/money'
import { replacePlayer } from './betting'
import { statusAfterChipsAdded, validateMoney, type MoneyInput } from './buy-ins'
import { err, ok, type ReducerResult } from './result'
import { InvalidAction } from './state/errors'
import type { GamePlayer, GameSnapshot } from './state/types'

const decodeMoney = Schema.decodeUnknownSync(Money)

// During an active hand only players who are out of the action may rebuy
// (SPEC.md Buy-Ins): their chips defer to the next hand so current-hand
// side pots and eligibility cannot change.
const MID_HAND_REBUYABLE: ReadonlySet<GamePlayer['handStatus']> = new Set([
  'folded',
  'out-of-hand',
  'sitting-out',
  'needs-rebuy',
])

export function recordRebuy(
  snapshot: GameSnapshot,
  playerIdRaw: string,
  money: MoneyInput,
  chips: number,
): ReducerResult {
  if (snapshot.game.status === 'finished') {
    return err(new InvalidAction({ reason: 'game is finished' }))
  }
  const invalid = validateMoney(snapshot, money, chips)
  if (invalid) return invalid

  // ADR 0002: a rebuy is capped at the table default (money and chips) —
  // any amount above zero up to the default. The rebuy screen offers
  // Full / Half / Custom, all of which fit under this cap.
  const { defaultBuyInCents, defaultStack } = snapshot.game.settings
  if (money.cents > defaultBuyInCents || chips > defaultStack) {
    return err(
      new InvalidAction({
        reason: `rebuy is capped at the table default (${defaultBuyInCents} cents / ${defaultStack} chips)`,
      }),
    )
  }

  const player = snapshot.players.find((p) => p.id === playerIdRaw)
  if (!player) {
    return err(new InvalidAction({ reason: 'unknown player for rebuy' }))
  }

  const midHand =
    snapshot.game.status === 'in-hand' || snapshot.game.status === 'showdown'
  if (midHand && !MID_HAND_REBUYABLE.has(player.handStatus)) {
    return err(
      new InvalidAction({
        reason: 'players still contesting the hand cannot rebuy',
      }),
    )
  }

  const withTotals: GamePlayer = {
    ...player,
    totalBuyInCents: makeCents(player.totalBuyInCents + money.cents),
    totalChipsPurchased: makeChips(player.totalChipsPurchased + chips),
  }

  const next: GamePlayer = midHand
    ? {
        ...withTotals,
        pendingRebuyChips: makeChips(player.pendingRebuyChips + chips),
      }
    : (() => {
        const credited: GamePlayer = {
          ...withTotals,
          stack: makeChips(player.stack + chips),
        }
        return { ...credited, handStatus: statusAfterChipsAdded(credited) }
      })()

  return ok(
    { ...snapshot, players: replacePlayer(snapshot.players, next) },
    [
      {
        _tag: 'rebuy-recorded',
        playerId: player.id,
        money: decodeMoney(money),
        chips: makeChips(chips),
      },
    ],
  )
}
