import { recordBuyIn } from '../buy-ins'
import { finalizeCashOut, finishGame } from '../cash-out'
import { applyCorrection, restoreFoldedPlayer, setActivePlayer } from '../corrections'
import { recordRebuy } from '../rebuy'
import { resetGame } from '../reset'
import { err, type ReducerResult } from '../result'
import { claimSeat, markInterruptedFolded, releaseSeat } from '../seats'
import {
  configureGame,
  setDealer,
  updateAmountStep,
  updateBlinds,
  updateRaiseRule,
  updateStrictMode,
} from '../settings'
import { awardPot, splitPot, takeAllEligiblePots } from '../settlement'
import { returnFromSitOut, sitOut } from '../sit-out'
import { nonUndoableReason, undoVisibleTransaction } from '../undo'
import type { VisibleTransaction } from '../visible-transactions'
import { InvalidAction } from '../state/errors'
import type { GameCommand, GameSnapshot } from '../state/types'
import { applyPlayerAction } from './action-reducer'
import { cancelHand, confirmNextStreet, startHand } from './hand-reducer'

export interface CommandContext {
  /** Seat owned by the submitting connection; null for unseated actors. */
  actingSeat: number | null
  /** Server-generated id when the command starts a new hand. */
  handId?: string
  /** Server-generated id when a claim creates a new player. */
  playerId?: string
  /** Profile display name resolved by the server for new players. */
  playerName?: string
  /** Latest visible transaction, loaded by the server for undo. */
  latestTransaction?: VisibleTransaction
}

/**
 * Route an in-game command to its reducer. Slice 2 wires the normal-hand
 * commands; later slices extend this dispatch (settlement, recovery, money).
 */
export function applyGameCommand(
  snapshot: GameSnapshot,
  command: GameCommand,
  context: CommandContext,
): ReducerResult {
  switch (command._tag) {
    case 'start-hand':
      if (!context.handId) {
        return err(new InvalidAction({ reason: 'start-hand requires a hand id' }))
      }
      return startHand(snapshot, context.handId)
    case 'confirm-next-street':
      return confirmNextStreet(snapshot)
    case 'fold':
    case 'check':
    case 'call':
    case 'go-all-in': {
      if (context.actingSeat === null) {
        return err(new InvalidAction({ reason: 'normal actions require a claimed seat' }))
      }
      const kind = command._tag === 'go-all-in' ? 'all-in' : command._tag
      return applyPlayerAction(snapshot, context.actingSeat, { kind })
    }
    case 'bet':
    case 'raise': {
      if (context.actingSeat === null) {
        return err(new InvalidAction({ reason: 'normal actions require a claimed seat' }))
      }
      return applyPlayerAction(snapshot, context.actingSeat, {
        kind: command._tag,
        amount: command.amount,
      })
    }
    case 'award-pot':
      return awardPot(snapshot, command.potId, command.winnerId)
    case 'split-pot':
      return splitPot(snapshot, command.potId, command.allocations)
    case 'take-all-eligible-pots':
      return takeAllEligiblePots(snapshot, command.winnerId)
    case 'claim-seat':
      return claimSeat(snapshot, command.seatIndex, command.profileId, context)
    case 'release-seat':
      return releaseSeat(snapshot, command.seatIndex)
    case 'configure-game':
      return configureGame(snapshot, command.settings)
    case 'set-dealer':
      return setDealer(snapshot, command.seatIndex)
    case 'update-blinds':
      return updateBlinds(snapshot, command.smallBlind, command.bigBlind)
    case 'update-strict-mode':
      return updateStrictMode(snapshot, command.enabled)
    case 'update-raise-rule':
      return updateRaiseRule(snapshot, command.rule)
    case 'update-amount-step':
      return updateAmountStep(snapshot, command.step)
    case 'cancel-hand':
      return cancelHand(snapshot)
    case 'reset-game':
      return resetGame(snapshot)
    case 'mark-interrupted-folded':
      return markInterruptedFolded(snapshot, command.seatIndex)
    case 'apply-correction':
      return applyCorrection(snapshot, command.reason, command.moves)
    case 'restore-folded-player':
      return restoreFoldedPlayer(snapshot, command.seatIndex)
    case 'set-active-player':
      return setActivePlayer(snapshot, command.seatIndex)
    case 'sit-out':
      if (context.actingSeat === null) {
        return err(new InvalidAction({ reason: 'sit-out requires a claimed seat' }))
      }
      return sitOut(snapshot, context.actingSeat)
    case 'return-from-sit-out':
      if (context.actingSeat === null) {
        return err(
          new InvalidAction({ reason: 'return from sit-out requires a claimed seat' }),
        )
      }
      return returnFromSitOut(snapshot, context.actingSeat)
    case 'undo': {
      const latest = context.latestTransaction
      if (!latest) {
        return err(new InvalidAction({ reason: 'nothing to undo' }))
      }
      if (
        command.expectedTransactionId !== undefined &&
        command.expectedTransactionId !== latest.id
      ) {
        return err(
          new InvalidAction({
            reason: 'the table changed since the undo preview; reopen undo',
          }),
        )
      }
      const nonUndoable = nonUndoableReason(latest.events)
      if (nonUndoable !== null) {
        return err(new InvalidAction({ reason: nonUndoable }))
      }
      return undoVisibleTransaction(snapshot, latest)
    }
    case 'record-buy-in':
      return recordBuyIn(snapshot, command.playerId, command.money, command.chips)
    case 'record-rebuy':
      return recordRebuy(snapshot, command.playerId, command.money, command.chips)
    case 'finish-game':
      return finishGame(snapshot)
    case 'finalize-cash-out':
      return finalizeCashOut(snapshot, command.transfers)
  }
}
