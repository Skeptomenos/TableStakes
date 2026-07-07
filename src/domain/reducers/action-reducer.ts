import { makeChips } from '../../shared/chips'
import { commitTo, commitmentFor, replaceCommitment, replacePlayer } from '../betting'
import { minOpeningBet, minRaiseTo } from '../raise-rules'
import { err, ok, type ReducerResult, type ReducerWarning } from '../result'
import { isActionable, isLive, seatsAfter } from '../turn-order'
import {
  InsufficientStack,
  InvalidAction,
  NotActivePlayer,
  StrictRuleViolation,
} from '../state/errors'
import type {
  GameEvent,
  GamePlayer,
  GameSnapshot,
  HandState,
  SeatCommitment,
} from '../state/types'
import { settleUncontested } from './hand-reducer'

export type PlayerAction =
  | { kind: 'fold' }
  | { kind: 'check' }
  | { kind: 'call' }
  | { kind: 'bet'; amount: number }
  | { kind: 'raise'; amount: number }
  | { kind: 'all-in' }

/**
 * Apply a normal poker action from the active claimed seat. Bet and raise
 * amounts are street bet-to totals. Always-on guardrails (turn ownership,
 * stack limits, chip conservation) hold in both modes; strict mode
 * additionally blocks what soft mode only warns about.
 */
export function applyPlayerAction(
  snapshot: GameSnapshot,
  seatIndex: number,
  action: PlayerAction,
): ReducerResult {
  const hand = snapshot.hand
  if (!hand || snapshot.game.status !== 'in-hand') {
    return err(new InvalidAction({ reason: 'no active hand' }))
  }
  if (hand.activeSeat !== seatIndex) {
    return err(new NotActivePlayer({ seatIndex }))
  }
  const player = snapshot.players.find((p) => p.seatIndex === seatIndex)
  if (!player || !isActionable(player)) {
    return err(new NotActivePlayer({ seatIndex }))
  }

  const settings = snapshot.game.settings
  const strict = settings.strictMode
  const commitment = commitmentFor(hand, seatIndex)
  if (!commitment) {
    return err(
      new InvalidAction({ reason: `seat ${seatIndex} is not dealt into this hand` }),
    )
  }
  const owed = hand.currentBet - commitment.street
  const warnings: ReducerWarning[] = []

  switch (action.kind) {
    case 'fold': {
      const players = replacePlayer(snapshot.players, {
        ...player,
        handStatus: 'folded',
      })
      const events: GameEvent[] = [{ _tag: 'folded', seatIndex: player.seatIndex }]
      const afterFold: GameSnapshot = { ...snapshot, players }

      if (afterFold.players.filter(isLive).length === 1) {
        return settleUncontested(afterFold, events)
      }
      return ok(
        advance(afterFold, hand, players, seatIndex),
        events,
        warnings,
      )
    }

    case 'check': {
      if (owed > 0) {
        if (strict) {
          return err(
            new StrictRuleViolation({
              rule: 'check',
              message: `cannot check facing a bet of ${hand.currentBet}`,
            }),
          )
        }
        warnings.push({
          code: 'check-facing-bet',
          message: `checked while ${owed} was owed to call`,
        })
      }
      const nextHand = withActed(hand, commitment.seatIndex)
      const events: GameEvent[] = [{ _tag: 'checked', seatIndex: player.seatIndex }]
      return ok(
        advance(snapshot, nextHand, snapshot.players, seatIndex),
        events,
        warnings,
      )
    }

    case 'call': {
      // Nothing owed makes `call` unavailable: strict mode rejects it, soft
      // mode records the tap as a check — never a zero-chip `called` event
      // (PR #165 re-review fix).
      if (owed <= 0) {
        if (strict) {
          return err(
            new StrictRuleViolation({
              rule: 'call',
              message: 'nothing to call; check instead',
            }),
          )
        }
        warnings.push({
          code: 'call-with-nothing-owed',
          message: 'nothing to call; recorded as a check',
        })
        const nextHand = withActed(hand, commitment.seatIndex)
        return ok(
          advance(snapshot, nextHand, snapshot.players, seatIndex),
          [{ _tag: 'checked', seatIndex: player.seatIndex }],
          warnings,
        )
      }
      // Capped by stack: a short call is an all-in for less.
      const committed = commitTo(player, commitment, hand.currentBet)
      const players = replacePlayer(snapshot.players, committed.player)
      const commitments = replaceCommitment(hand.commitments, committed.commitment)
      const nextHand = withActed({ ...hand, commitments }, commitment.seatIndex)
      const events: GameEvent[] = committed.allIn
        ? [
            {
              _tag: 'all-in',
              seatIndex: player.seatIndex,
              amount: committed.commitment.street,
            },
          ]
        : [
            {
              _tag: 'called',
              seatIndex: player.seatIndex,
              amount: makeChips(committed.paid),
            },
          ]
      return ok(advance(snapshot, nextHand, players, seatIndex), events, warnings)
    }

    case 'bet': {
      if (hand.currentBet > 0) {
        return err(
          new InvalidAction({ reason: 'a bet is already live on this street; raise instead' }),
        )
      }
      const net = action.amount - commitment.street
      if (net <= 0) {
        return err(new InvalidAction({ reason: 'bet must exceed current commitment' }))
      }
      if (net > player.stack) {
        return err(
          new InsufficientStack({
            seatIndex,
            requested: net,
            available: player.stack,
          }),
        )
      }
      const minOpen = minOpeningBet(settings.raiseRule, settings)
      if (action.amount < minOpen) {
        if (strict) {
          return err(
            new StrictRuleViolation({
              rule: settings.raiseRule,
              message: `minimum opening bet is ${minOpen}`,
            }),
          )
        }
        warnings.push({
          code: 'below-minimum-bet',
          message: `bet ${action.amount} is below the minimum opening bet ${minOpen}`,
        })
      }
      return commitAggression(snapshot, hand, player, commitment, seatIndex, {
        betTo: action.amount,
        full: true,
        eventTag: 'bet',
        warnings,
      })
    }

    case 'raise': {
      if (hand.currentBet === 0) {
        return err(new InvalidAction({ reason: 'nothing to raise; bet instead' }))
      }
      if (action.amount <= hand.currentBet) {
        return err(
          new InvalidAction({
            reason: `raise must exceed the current bet of ${hand.currentBet}`,
          }),
        )
      }
      const net = action.amount - commitment.street
      if (net > player.stack) {
        return err(
          new InsufficientStack({
            seatIndex,
            requested: net,
            available: player.stack,
          }),
        )
      }
      const isAllIn = net === player.stack

      // An all-in below the rule minimum does not reopen betting: players
      // who already acted may only call or fold — the restriction covers
      // ALL re-raises, all-in included (SPEC.md Raise Rules; verification
      // finding F1).
      if (hand.actedSeats.includes(player.seatIndex)) {
        if (strict) {
          return err(
            new StrictRuleViolation({
              rule: settings.raiseRule,
              message: 'betting was not reopened by a full raise',
            }),
          )
        }
        warnings.push({
          code: 'betting-not-reopened',
          message: 'raising again although no full raise reopened betting',
        })
      }

      if (!isAllIn && action.amount < hand.minRaiseTo) {
        if (strict) {
          return err(
            new StrictRuleViolation({
              rule: settings.raiseRule,
              message: `minimum raise is ${hand.minRaiseTo}`,
            }),
          )
        }
        warnings.push({
          code: 'below-minimum-raise',
          message: `raise to ${action.amount} is below the minimum ${hand.minRaiseTo}`,
        })
      }

      return commitAggression(snapshot, hand, player, commitment, seatIndex, {
        betTo: action.amount,
        full: action.amount >= hand.minRaiseTo,
        eventTag: isAllIn ? 'all-in' : 'raised',
        warnings,
      })
    }

    case 'all-in': {
      const betTo = commitment.street + player.stack
      if (betTo <= hand.currentBet) {
        // All-in for less than the current bet: a call for less.
        const committed = commitTo(player, commitment, betTo)
        const players = replacePlayer(snapshot.players, committed.player)
        const commitments = replaceCommitment(hand.commitments, committed.commitment)
        const nextHand = withActed({ ...hand, commitments }, commitment.seatIndex)
        return ok(
          advance(snapshot, nextHand, players, seatIndex),
          [{ _tag: 'all-in', seatIndex: player.seatIndex, amount: makeChips(betTo) }],
          warnings,
        )
      }
      // Above the current bet this all-in is a re-raise: the no-reopen
      // restriction applies to acted players exactly as for normal raises
      // (SPEC.md Raise Rules; verification finding F1). Sizing itself is
      // exempt — a short all-in never warns about the minimum.
      if (hand.currentBet > 0 && hand.actedSeats.includes(player.seatIndex)) {
        if (strict) {
          return err(
            new StrictRuleViolation({
              rule: settings.raiseRule,
              message: 'betting was not reopened by a full raise',
            }),
          )
        }
        warnings.push({
          code: 'betting-not-reopened',
          message: 'raising again although no full raise reopened betting',
        })
      }
      // A short all-in is never a full bet — not even as the opener:
      // hand.minRaiseTo holds the minimum opening bet when nothing is live,
      // and prior checkers keep their acted status (PR #165 review fix).
      return commitAggression(snapshot, hand, player, commitment, seatIndex, {
        betTo,
        full: betTo >= hand.minRaiseTo,
        eventTag: 'all-in',
        warnings,
      })
    }
  }
}

interface AggressionSpec {
  betTo: number
  full: boolean
  eventTag: 'bet' | 'raised' | 'all-in'
  warnings: ReducerWarning[]
}

function commitAggression(
  snapshot: GameSnapshot,
  hand: HandState,
  player: GamePlayer,
  commitment: SeatCommitment,
  seatIndex: number,
  spec: AggressionSpec,
): ReducerResult {
  const settings = snapshot.game.settings
  const committed = commitTo(player, commitment, spec.betTo)
  const players = replacePlayer(snapshot.players, committed.player)
  const commitments = replaceCommitment(hand.commitments, committed.commitment)

  const lastRaiseSize = spec.full
    ? makeChips(Math.max(1, spec.betTo - hand.currentBet))
    : hand.lastRaiseSize
  const actedSeats = spec.full
    ? [player.seatIndex]
    : dedupe([...hand.actedSeats, player.seatIndex])

  const nextHand: HandState = {
    ...hand,
    commitments,
    currentBet: makeChips(spec.betTo),
    lastRaiseSize,
    lastFullRaiseTo: spec.full ? makeChips(spec.betTo) : hand.lastFullRaiseTo,
    minRaiseTo: makeChips(
      minRaiseTo(settings.raiseRule, spec.betTo, lastRaiseSize, settings),
    ),
    actedSeats,
  }

  const eventTag = committed.allIn ? 'all-in' : spec.eventTag
  const events: GameEvent[] = [
    { _tag: eventTag, seatIndex: player.seatIndex, amount: makeChips(spec.betTo) },
  ]
  return ok(advance(snapshot, nextHand, players, seatIndex), events, spec.warnings)
}

function withActed(hand: HandState, seat: SeatCommitment['seatIndex']): HandState {
  return { ...hand, actedSeats: dedupe([...hand.actedSeats, seat]) }
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/**
 * Move the turn to the next seat that still owes action: actionable and
 * either unmatched against the current bet or not yet acted this street.
 * No such seat -> betting closes and `Next street` becomes ready.
 */
function advance(
  snapshot: GameSnapshot,
  hand: HandState,
  players: readonly GamePlayer[],
  fromSeat: number,
): GameSnapshot {
  const dealtInSeats = new Set(hand.commitments.map((c) => c.seatIndex))
  const candidates = seatsAfter(
    players.filter((p) => dealtInSeats.has(p.seatIndex)),
    fromSeat,
  )
  const nextActor = candidates.find((p) => {
    if (!isActionable(p)) return false
    const street = hand.commitments.find((c) => c.seatIndex === p.seatIndex)!.street
    return street < hand.currentBet || !hand.actedSeats.includes(p.seatIndex)
  })

  return {
    ...snapshot,
    players: [...players],
    hand: {
      ...hand,
      activeSeat: nextActor?.seatIndex ?? null,
      nextStreetReady: nextActor === undefined,
    },
  }
}
