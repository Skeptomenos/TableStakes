import { err, ok, type ReducerResult } from './result'
import { InvalidAction } from './state/errors'
import type {
  AmountStep,
  ChipAmount,
  GameEvent,
  GameSettings,
  GameSnapshot,
  RaiseRule,
} from './state/types'

// Shared audited game settings (SPEC.md): blind, strict-mode, and
// raise-rule changes apply from the NEXT hand; amount step applies
// immediately. Mid-hand changes wait in game.pendingSettings and land in
// closeHand.

function applyPatch(
  snapshot: GameSnapshot,
  patch: Partial<GameSettings>,
  events: GameEvent[],
  applyImmediately: boolean,
): ReducerResult {
  const game = snapshot.game
  const midHand = game.status === 'in-hand' || game.status === 'showdown'

  if (applyImmediately || !midHand) {
    return ok(
      {
        ...snapshot,
        game: {
          ...game,
          settings: { ...game.settings, ...patch },
          // Keep an already-pending change consistent with the immediate one.
          pendingSettings: game.pendingSettings
            ? { ...game.pendingSettings, ...patch }
            : null,
        },
      },
      events,
    )
  }

  return ok(
    {
      ...snapshot,
      game: {
        ...game,
        pendingSettings: { ...(game.pendingSettings ?? game.settings), ...patch },
      },
    },
    events,
  )
}

export function updateBlinds(
  snapshot: GameSnapshot,
  smallBlind: ChipAmount,
  bigBlind: ChipAmount,
): ReducerResult {
  return applyPatch(
    snapshot,
    { smallBlind, bigBlind },
    [{ _tag: 'blinds-updated', smallBlind, bigBlind }],
    false,
  )
}

export function updateStrictMode(
  snapshot: GameSnapshot,
  enabled: boolean,
): ReducerResult {
  return applyPatch(
    snapshot,
    { strictMode: enabled },
    [{ _tag: 'strict-mode-updated', enabled }],
    false,
  )
}

export function updateRaiseRule(
  snapshot: GameSnapshot,
  rule: RaiseRule,
): ReducerResult {
  return applyPatch(
    snapshot,
    { raiseRule: rule },
    [{ _tag: 'raise-rule-updated', rule }],
    false,
  )
}

export function updateAmountStep(
  snapshot: GameSnapshot,
  step: AmountStep,
): ReducerResult {
  return applyPatch(
    snapshot,
    { amountStep: step },
    [{ _tag: 'amount-step-updated', step }],
    true,
  )
}

/** First-hand setup commit: replaces settings wholesale, setup only. */
export function configureGame(
  snapshot: GameSnapshot,
  settings: GameSettings,
): ReducerResult {
  if (snapshot.game.status !== 'setup') {
    return err(
      new InvalidAction({ reason: 'configure-game is only available in setup' }),
    )
  }
  return ok(
    { ...snapshot, game: { ...snapshot.game, settings } },
    [{ _tag: 'game-configured', settings }],
  )
}

export function setDealer(
  snapshot: GameSnapshot,
  seatIndex: number,
): ReducerResult {
  if (
    snapshot.game.status !== 'setup' &&
    snapshot.game.status !== 'between-hands'
  ) {
    return err(new InvalidAction({ reason: 'dealer changes happen between hands' }))
  }
  const player = snapshot.players.find((p) => p.seatIndex === seatIndex)
  if (!player) {
    return err(new InvalidAction({ reason: 'dealer seat has no player' }))
  }
  return ok(
    {
      ...snapshot,
      game: { ...snapshot.game, dealerSeat: player.seatIndex },
    },
    [{ _tag: 'dealer-set', seatIndex: player.seatIndex }],
  )
}
