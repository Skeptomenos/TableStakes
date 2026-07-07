import { makeChips } from '../../shared/chips'
import { HandId, PotId } from '../../shared/schema/ids'
import { commitTo, replaceCommitment, replacePlayer } from '../betting'
import { minOpeningBet, minRaiseTo } from '../raise-rules'
import { err, ok, type ReducerResult } from '../result'
import { buildPots, uncalledExcess } from '../side-pots'
import { nextStreet } from '../street'
import { bySeat, canDealIn, isActionable, isLive, nextSeatWhere, seatsAfter } from '../turn-order'
import { InvalidAction } from '../state/errors'
import type {
  GameEvent,
  GamePlayer,
  GameSnapshot,
  HandState,
  SeatCommitment,
} from '../state/types'

/**
 * Start the next hand: pick dealer (skipping busted/empty/sitting-out
 * seats), post blinds (short stacks post all-in for less), set the first
 * actor. Heads-up: the dealer posts the small blind and acts first pre-flop.
 */
export function startHand(
  snapshot: GameSnapshot,
  handIdRaw: string,
): ReducerResult {
  if (
    snapshot.game.status !== 'between-hands' &&
    snapshot.game.status !== 'setup'
  ) {
    return err(
      new InvalidAction({ reason: `cannot start hand in ${snapshot.game.status}` }),
    )
  }

  const dealtIn = bySeat(snapshot.players.filter(canDealIn))
  if (dealtIn.length < 2) {
    return err(
      new InvalidAction({ reason: 'a hand requires at least 2 players with chips' }),
    )
  }

  const settings = snapshot.game.settings

  // Dead button: if the intended dealer seat cannot be dealt in, the button
  // skips to the next dealt-in seat (SPEC.md Blinds).
  const intendedDealer = snapshot.game.dealerSeat ?? dealtIn[0]!.seatIndex
  const dealer =
    dealtIn.find((p) => p.seatIndex === intendedDealer) ??
    nextSeatWhere(dealtIn, intendedDealer, () => true)!

  const headsUp = dealtIn.length === 2
  const sbPlayer = headsUp
    ? dealer
    : nextSeatWhere(dealtIn, dealer.seatIndex, () => true)!
  const bbPlayer = nextSeatWhere(dealtIn, sbPlayer.seatIndex, () => true)!

  // Hand statuses: dealt-in players wait; everyone else sits out or needs a
  // rebuy. Returning sit-out players are dealt in with no penalty.
  const dealtInSeats = new Set(dealtIn.map((p) => p.seatIndex))
  let players: GamePlayer[] = snapshot.players.map((p) =>
    dealtInSeats.has(p.seatIndex)
      ? { ...p, handStatus: 'waiting' as const }
      : {
          ...p,
          handStatus: p.stack === 0 ? ('needs-rebuy' as const) : ('sitting-out' as const),
        },
  )

  let commitments: SeatCommitment[] = dealtIn.map((p) => ({
    seatIndex: p.seatIndex,
    street: makeChips(0),
    total: makeChips(0),
  }))

  const events: GameEvent[] = []
  const handNumber = snapshot.game.lastHandNumber + 1
  events.push({
    _tag: 'hand-started',
    handNumber,
    dealerSeat: dealer.seatIndex,
    smallBlindSeat: sbPlayer.seatIndex,
    bigBlindSeat: bbPlayer.seatIndex,
  })

  // Post blinds. commitTo caps at the stack: a short blind posts all-in for
  // less; side-pot accounting (Slice 3) handles the shortfall.
  for (const [blindPlayer, kind, amount] of [
    [sbPlayer, 'small', settings.smallBlind],
    [bbPlayer, 'big', settings.bigBlind],
  ] as const) {
    const current = players.find((p) => p.seatIndex === blindPlayer.seatIndex)!
    const commitment = commitments.find(
      (c) => c.seatIndex === blindPlayer.seatIndex,
    )!
    const committed = commitTo(current, commitment, amount)
    players = replacePlayer(players, committed.player)
    commitments = replaceCommitment(commitments, committed.commitment)
    events.push({
      _tag: 'blind-posted',
      seatIndex: blindPlayer.seatIndex,
      kind,
      amount: makeChips(committed.paid),
    })
  }

  // The amount to match stays the nominal big blind even when the big blind
  // is all-in for less (SPEC.md Blinds).
  const currentBet = settings.bigBlind

  // First actor: pre-flop action starts after the big blind; heads-up the
  // dealer/small-blind acts first. If blind posting left fewer than two
  // players able to act, betting is dead and the hand runs out.
  const candidates = headsUp
    ? [
        players.find((p) => p.seatIndex === dealer.seatIndex)!,
        players.find((p) => p.seatIndex === bbPlayer.seatIndex)!,
      ]
    : seatsAfter(
        players.filter((p) => dealtInSeats.has(p.seatIndex)),
        bbPlayer.seatIndex,
      )
  const actionableCount = players.filter(
    (p) => dealtInSeats.has(p.seatIndex) && isActionable(p),
  ).length
  const firstActor =
    actionableCount >= 2 ? (candidates.find(isActionable) ?? null) : null

  const hand: HandState = {
    id: HandId.make(handIdRaw),
    handNumber,
    dealerSeat: dealer.seatIndex,
    smallBlindSeat: sbPlayer.seatIndex,
    bigBlindSeat: bbPlayer.seatIndex,
    street: 'pre-flop',
    activeSeat: firstActor?.seatIndex ?? null,
    currentBet,
    minRaiseTo: makeChips(
      minRaiseTo(settings.raiseRule, currentBet, settings.bigBlind, settings),
    ),
    lastRaiseSize: settings.bigBlind,
    lastFullRaiseTo: settings.bigBlind,
    actedSeats: [],
    nextStreetReady: firstActor === null,
    commitments,
  }

  return ok(
    {
      ...snapshot,
      game: { ...snapshot.game, status: 'in-hand' },
      players,
      hand,
    },
    events,
  )
}

/**
 * Advance to the next street after the table confirms the physical cards
 * are dealt. Never automatic (SPEC.md Hand Flow). River -> showdown.
 */
export function confirmNextStreet(snapshot: GameSnapshot): ReducerResult {
  const hand = snapshot.hand
  if (!hand || snapshot.game.status !== 'in-hand') {
    return err(new InvalidAction({ reason: 'no active hand' }))
  }
  if (!hand.nextStreetReady) {
    return err(new InvalidAction({ reason: 'betting is still open on this street' }))
  }

  const street = nextStreet(hand.street)
  if (street === null) {
    return err(new InvalidAction({ reason: 'hand is already at showdown' }))
  }

  const events: GameEvent[] = [{ _tag: 'street-advanced', street }]

  if (street === 'showdown') {
    // Return the uncalled portion of the highest bet, then lock commitments
    // into the ordered pot stack. Chips move commitments -> pots so the
    // conservation total is unchanged.
    let players = snapshot.players
    let commitments = hand.commitments
    const excess = uncalledExcess(commitments)
    if (excess) {
      const player = players.find((p) => p.seatIndex === excess.seatIndex)!
      players = replacePlayer(players, {
        ...player,
        stack: makeChips(player.stack + excess.amount),
      })
      commitments = commitments.map((c) =>
        c.seatIndex === excess.seatIndex
          ? { ...c, total: makeChips(c.total - excess.amount) }
          : c,
      )
      events.push({
        _tag: 'uncalled-bet-returned',
        seatIndex: excess.seatIndex,
        amount: makeChips(excess.amount),
      })
    }

    const pots = buildPots(hand.id, players, commitments)
    for (const pot of pots) {
      events.push({ _tag: 'pot-created', potId: pot.id, label: pot.label })
    }

    return ok(
      {
        ...snapshot,
        game: { ...snapshot.game, status: 'showdown' },
        players,
        pots,
        hand: {
          ...hand,
          street,
          activeSeat: null,
          nextStreetReady: false,
          commitments: commitments.map((c) => ({
            ...c,
            street: makeChips(0),
            total: makeChips(0),
          })),
        },
      },
      events,
    )
  }

  const settings = snapshot.game.settings
  const commitments = hand.commitments.map((c) => ({
    ...c,
    street: makeChips(0),
  }))

  // Post-flop action starts with the first actionable seat after the dealer
  // (heads-up: the big blind). Betting needs at least two players who can
  // act; all-in run-outs have no actor and every street stays ready.
  const dealtInSeats = new Set(hand.commitments.map((c) => c.seatIndex))
  const dealtInPlayers = snapshot.players.filter((p) =>
    dealtInSeats.has(p.seatIndex),
  )
  const firstActor =
    dealtInPlayers.filter(isActionable).length >= 2
      ? nextSeatWhere(dealtInPlayers, hand.dealerSeat, isActionable)
      : null

  return ok(
    {
      ...snapshot,
      hand: {
        ...hand,
        street,
        commitments,
        currentBet: makeChips(0),
        minRaiseTo: makeChips(minOpeningBet(settings.raiseRule, settings)),
        lastRaiseSize: settings.bigBlind,
        lastFullRaiseTo: makeChips(0),
        actedSeats: [],
        activeSeat: firstActor?.seatIndex ?? null,
        nextStreetReady: firstActor === null,
      },
    },
    events,
  )
}

/**
 * Uncontested win: everyone folded except one live player. Award the whole
 * pot, close the hand, advance the button. One bundled visible transaction.
 */
export function settleUncontested(
  snapshot: GameSnapshot,
  events: GameEvent[],
): ReducerResult {
  const hand = snapshot.hand
  if (!hand) {
    return err(new InvalidAction({ reason: 'no active hand' }))
  }
  const live = snapshot.players.filter(isLive)
  if (live.length !== 1) {
    return err(
      new InvalidAction({ reason: 'uncontested settlement requires exactly one live player' }),
    )
  }
  const winner = live[0]!

  // Audit symmetry with the showdown path (verification F3): the winner's
  // own uncalled excess returns as an explicit event so `pot-awarded`
  // states only the contested amount. A folder's overcommitment is dead
  // money and stays in the pot — folding forfeits it.
  const bundled: GameEvent[] = [...events]
  let commitments = hand.commitments
  const excess = uncalledExcess(commitments)
  let returned = 0
  if (excess && excess.seatIndex === winner.seatIndex) {
    returned = excess.amount
    commitments = commitments.map((c) =>
      c.seatIndex === excess.seatIndex
        ? { ...c, total: makeChips(c.total - excess.amount) }
        : c,
    )
    bundled.push({
      _tag: 'uncalled-bet-returned',
      seatIndex: excess.seatIndex,
      amount: makeChips(excess.amount),
    })
  }

  const potAmount = commitments.reduce((sum, c) => sum + c.total, 0)
  const potId = PotId.make(`pot_${hand.id}_main`)

  const players = replacePlayer(snapshot.players, {
    ...winner,
    stack: makeChips(winner.stack + returned + potAmount),
  })

  return ok(
    closeHand({ ...snapshot, players }, hand),
    [
      ...bundled,
      { _tag: 'pot-created', potId, label: 'Main Pot' },
      {
        _tag: 'pot-awarded',
        potId,
        winnerId: winner.id,
        amount: makeChips(potAmount),
      },
      { _tag: 'hand-settled' },
    ],
  )
}

/**
 * Cancel the current hand (SPEC.md): every commitment, blinds included,
 * returns to its stack; no pots are awarded; the button and hand number do
 * not advance, so the next hand re-posts from the same positions. Only
 * available during betting — at showdown the chips already moved into the
 * pot stack, where an awarded pot is indistinguishable from a settled side
 * pot, so recovery steps back through undo instead.
 */
export function cancelHand(snapshot: GameSnapshot): ReducerResult {
  if (snapshot.game.status === 'showdown') {
    return err(
      new InvalidAction({
        reason: 'hand is at showdown; undo the last table action instead',
      }),
    )
  }
  const hand = snapshot.hand
  if (!hand || snapshot.game.status !== 'in-hand') {
    return err(new InvalidAction({ reason: 'no active hand to cancel' }))
  }

  const refunds = new Map(hand.commitments.map((c) => [c.seatIndex, c.total]))
  // Pending mid-hand rebuys were only deferred to protect this hand's
  // eligibility; a voided hand releases them like closeHand would.
  const players = snapshot.players.map((p) => {
    const stack = makeChips(
      p.stack + (refunds.get(p.seatIndex) ?? 0) + p.pendingRebuyChips,
    )
    return {
      ...p,
      stack,
      pendingRebuyChips: makeChips(0),
      handStatus:
        stack === 0
          ? ('needs-rebuy' as const)
          : p.sitOutNextHand
            ? ('sitting-out' as const)
            : ('waiting' as const),
    }
  })

  return ok(
    {
      ...snapshot,
      game: {
        ...snapshot.game,
        status: 'between-hands',
        // The re-posted hand is a next hand: deferred settings apply.
        settings: snapshot.game.pendingSettings ?? snapshot.game.settings,
        pendingSettings: null,
      },
      players,
      hand: null,
      pots: [],
    },
    [{ _tag: 'hand-cancelled' }],
  )
}

/**
 * Close a fully settled hand: reset player hand statuses (zero-chip players
 * need a rebuy, sit-out requests take effect), advance the button past
 * seats that cannot be dealt in, and return to between-hands.
 */
export function closeHand(
  snapshot: GameSnapshot,
  hand: HandState,
): GameSnapshot {
  // Mid-hand rebuys become available now: pending chips land on the stack
  // before zero-chip status is decided (SPEC.md rebuy timing).
  const players = snapshot.players.map((p) => {
    const stack = makeChips(p.stack + p.pendingRebuyChips)
    return {
      ...p,
      stack,
      pendingRebuyChips: makeChips(0),
      handStatus:
        stack === 0
          ? ('needs-rebuy' as const)
          : p.sitOutNextHand
            ? ('sitting-out' as const)
            : ('waiting' as const),
    }
  })
  const nextDealer = nextSeatWhere(players, hand.dealerSeat, canDealIn)

  return {
    ...snapshot,
    game: {
      ...snapshot.game,
      status: 'between-hands',
      dealerSeat: nextDealer?.seatIndex ?? null,
      lastHandNumber: hand.handNumber,
      // Deferred settings changes (blinds, strict mode, raise rule) apply
      // from the next hand (SPEC.md).
      settings: snapshot.game.pendingSettings ?? snapshot.game.settings,
      pendingSettings: null,
    },
    players,
    hand: null,
    pots: [],
  }
}
