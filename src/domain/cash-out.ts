import { makeCents, type CentAmount } from '../shared/money'
import { ProfileId } from '../shared/schema/ids'
import { err, ok, type ReducerResult } from './result'
import { InvalidAction } from './state/errors'
import type { GamePlayerId, GameSnapshot } from './state/types'

export interface PlayerCashOut {
  playerId: GamePlayerId
  profileId: ProfileId
  buyInCents: number
  finalChips: number
  cashOutCents: number
  netCents: number
}

export interface Transfer {
  fromProfileId: ProfileId
  toProfileId: ProfileId
  cents: CentAmount
}

export interface CashOutSummary {
  totalBuyInCents: number
  totalCashOutCents: number
  /** Cents that could not be assigned by exact proportion and were
   * distributed one-by-one to the largest fractional shares. */
  roundingRemainderCents: number
  players: PlayerCashOut[]
  suggestedTransfers: Transfer[]
}

/**
 * End-of-night cash-out (ARCHITECTURE.md Cash Settlement): each player's
 * share of the total buy-in pool is proportional to their final chips.
 * BigInt keeps the proportion exact; the floor remainder is distributed by
 * largest fractional part so total cash-out always equals total buy-ins.
 */
export function computeCashOut(snapshot: GameSnapshot): CashOutSummary {
  const players = snapshot.players
  const pool = players.reduce((sum, p) => sum + p.totalBuyInCents, 0)
  const finalChips = (p: (typeof players)[number]) =>
    p.stack + p.pendingRebuyChips
  const totalChips = players.reduce((sum, p) => sum + finalChips(p), 0)

  // Unreachable under chip conservation, but guarded (verification F2):
  // with zero chips in play, proportional shares are undefined — refund
  // every buy-in so conservation still holds and nothing is owed.
  if (totalChips === 0) {
    return {
      totalBuyInCents: pool,
      totalCashOutCents: pool,
      roundingRemainderCents: 0,
      players: players.map((p) => ({
        playerId: p.id,
        profileId: p.profileId,
        buyInCents: p.totalBuyInCents,
        finalChips: 0,
        cashOutCents: p.totalBuyInCents,
        netCents: 0,
      })),
      suggestedTransfers: [],
    }
  }

  const shares = players.map((p) => {
    const numerator = BigInt(pool) * BigInt(finalChips(p))
    return {
      player: p,
      floor: Number(numerator / BigInt(totalChips)),
      fraction: numerator % BigInt(totalChips),
    }
  })

  let remainder = pool - shares.reduce((sum, s) => sum + s.floor, 0)
  const roundingRemainderCents = remainder

  // Largest fractional share first; seat order breaks ties deterministically.
  const byFraction = [...shares].sort((a, b) =>
    a.fraction === b.fraction
      ? a.player.seatIndex - b.player.seatIndex
      : b.fraction > a.fraction
        ? 1
        : -1,
  )
  const extra = new Map<string, number>()
  for (const share of byFraction) {
    if (remainder <= 0) break
    extra.set(share.player.id, 1)
    remainder -= 1
  }

  const cashOuts: PlayerCashOut[] = shares.map(({ player, floor }) => {
    const cashOutCents = floor + (extra.get(player.id) ?? 0)
    return {
      playerId: player.id,
      profileId: player.profileId,
      buyInCents: player.totalBuyInCents,
      finalChips: finalChips(player),
      cashOutCents,
      netCents: cashOutCents - player.totalBuyInCents,
    }
  })

  return {
    totalBuyInCents: pool,
    totalCashOutCents: cashOuts.reduce((sum, p) => sum + p.cashOutCents, 0),
    roundingRemainderCents,
    players: cashOuts,
    suggestedTransfers: minimizeTransfers(
      cashOuts.map((p) => ({ profileId: p.profileId, netCents: p.netCents })),
    ),
  }
}

export interface NetPosition {
  profileId: string
  netCents: number
}

/**
 * Greedy transfer minimization: repeatedly settle the largest debtor
 * against the largest creditor. Produces at most n-1 transfers.
 */
export function minimizeTransfers(
  positions: readonly NetPosition[],
): Transfer[] {
  // Aggregate by profile in case one profile holds multiple seats.
  const nets = new Map<string, number>()
  for (const p of positions) {
    nets.set(p.profileId, (nets.get(p.profileId) ?? 0) + p.netCents)
  }
  const creditors = [...nets.entries()]
    .filter(([, net]) => net > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([profileId, net]) => ({ profileId, remaining: net }))
  const debtors = [...nets.entries()]
    .filter(([, net]) => net < 0)
    .sort((a, b) => a[1] - b[1])
    .map(([profileId, net]) => ({ profileId, remaining: -net }))

  const transfers: Transfer[] = []
  let c = 0
  let d = 0
  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c]!
    const debtor = debtors[d]!
    const cents = Math.min(creditor.remaining, debtor.remaining)
    if (cents > 0) {
      transfers.push({
        fromProfileId: ProfileId.make(debtor.profileId),
        toProfileId: ProfileId.make(creditor.profileId),
        cents: makeCents(cents),
      })
    }
    creditor.remaining -= cents
    debtor.remaining -= cents
    if (creditor.remaining === 0) c += 1
    if (debtor.remaining === 0) d += 1
  }
  return transfers
}

/** Finish the game and open end-of-night cash-out (any connected player). */
export function finishGame(snapshot: GameSnapshot): ReducerResult {
  if (
    snapshot.game.status !== 'between-hands' &&
    snapshot.game.status !== 'setup'
  ) {
    return err(
      new InvalidAction({
        reason: 'finish the current hand before ending the game',
      }),
    )
  }
  // An empty setup game has no cash-out meaning and would archive an
  // empty history row (Slice 12 decision).
  if (snapshot.players.length === 0) {
    return err(
      new InvalidAction({
        reason: 'nobody is seated; delete or reuse the game instead of finishing it',
      }),
    )
  }
  return ok(
    { ...snapshot, game: { ...snapshot.game, status: 'finished' } },
    [{ _tag: 'game-finished' }],
  )
}

/** Record the final (possibly user-edited) payment transfers. */
export function finalizeCashOut(
  snapshot: GameSnapshot,
  transfers: readonly { fromProfileId: string; toProfileId: string; cents: number }[],
): ReducerResult {
  if (snapshot.game.status !== 'finished') {
    return err(new InvalidAction({ reason: 'finish the game before cash-out' }))
  }
  for (const t of transfers) {
    if (
      !Number.isSafeInteger(t.cents) ||
      t.cents <= 0 ||
      t.fromProfileId.length === 0 ||
      t.toProfileId.length === 0
    ) {
      return err(new InvalidAction({ reason: 'invalid cash-out transfer' }))
    }
  }
  return ok(snapshot, [
    {
      _tag: 'cash-out-finalized',
      transfers: transfers.map((t) => ({
        fromProfileId: ProfileId.make(t.fromProfileId),
        toProfileId: ProfileId.make(t.toProfileId),
        cents: makeCents(t.cents),
      })),
    },
  ])
}
