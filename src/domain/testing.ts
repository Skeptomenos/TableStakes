import { applyPlayerAction, type PlayerAction } from './reducers/action-reducer'
import { confirmNextStreet, startHand } from './reducers/hand-reducer'
import { makeBetweenHandsSnapshot, makeTestSettings } from './state/fixtures'
import type { GameSnapshot } from './state/types'

// Test-only flow builders: drive real reducers instead of hand-crafting
// snapshots so test states can never drift from reducer behavior.

export function mustOk<
  T extends { ok: boolean },
>(result: T, context: string): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${context}: ${JSON.stringify(result)}`)
  }
  return result as Extract<T, { ok: true }>
}

export function startedHand(options: {
  playerCount: number
  dealerSeat?: number
  stacks?: Record<number, number>
  strictMode?: boolean
}): GameSnapshot {
  const snapshot = makeBetweenHandsSnapshot({
    playerCount: options.playerCount,
    dealerSeat: options.dealerSeat ?? 0,
    settings: makeTestSettings({ strictMode: options.strictMode ?? false }),
    playerOverrides: Object.fromEntries(
      Object.entries(options.stacks ?? {}).map(([seat, stack]) => [
        seat,
        { stack },
      ]),
    ),
  })
  return mustOk(startHand(snapshot, 'hand_1'), 'startHand').snapshot
}

export function played(
  snapshot: GameSnapshot,
  seatIndex: number,
  action: PlayerAction,
): GameSnapshot {
  return mustOk(
    applyPlayerAction(snapshot, seatIndex, action),
    `action ${action.kind} by seat ${seatIndex}`,
  ).snapshot
}

/**
 * Drive the hand to showdown: confirm streets when ready, otherwise tap
 * checks for whichever seat is active (only valid when no bet is open).
 */
export function runOutToShowdown(snapshot: GameSnapshot): GameSnapshot {
  let s = snapshot
  let safety = 100
  while (s.hand && s.hand.street !== 'showdown' && safety-- > 0) {
    if (s.hand.nextStreetReady) {
      s = mustOk(confirmNextStreet(s), `advance from ${s.hand.street}`).snapshot
    } else if (s.hand.activeSeat !== null) {
      s = played(s, s.hand.activeSeat, { kind: 'check' })
    } else {
      throw new Error('hand is stuck: no actor and street not ready')
    }
  }
  if (safety <= 0) throw new Error('runOutToShowdown did not terminate')
  return s
}
