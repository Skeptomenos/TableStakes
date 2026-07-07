import { Schema } from 'effect'

import { replacePlayer } from './betting'
import { applyPlayerAction } from './reducers/action-reducer'
import { err, ok, type ReducerResult } from './result'
import { InvalidAction, SeatAlreadyClaimed } from './state/errors'
import { GamePlayer } from '../shared/schema/snapshot'
import type { GameSnapshot } from './state/types'

const decodePlayer = Schema.decodeUnknownSync(GamePlayer)

export interface ClaimContext {
  /** Server-generated id when the claim creates a new player. */
  playerId?: string
  /** Profile display name resolved by the server. */
  playerName?: string
}

/**
 * Claim a seat (SPEC.md seat claiming rules): free seats are claimable,
 * actively connected seats are locked, and a reserved seat can only be
 * reclaimed by its own profile. The server layer additionally enforces the
 * live-socket lock and silent session-hint rules before dispatching here.
 */
export function claimSeat(
  snapshot: GameSnapshot,
  seatIndex: number,
  profileIdRaw: string,
  context: ClaimContext,
): ReducerResult {
  const existing = snapshot.players.find((p) => p.seatIndex === seatIndex)

  if (existing) {
    if (existing.connection === 'connected') {
      return err(new SeatAlreadyClaimed({ seatIndex }))
    }
    if (existing.profileId !== profileIdRaw) {
      return err(
        new InvalidAction({
          reason: 'seat is reserved for another profile; release it first',
        }),
      )
    }
    return ok(
      {
        ...snapshot,
        players: replacePlayer(snapshot.players, {
          ...existing,
          connection: 'connected',
        }),
      },
      [
        {
          _tag: 'seat-reconnected',
          seatIndex: existing.seatIndex,
          playerId: existing.id,
        },
      ],
    )
  }

  if (!context.playerId || !context.playerName) {
    return err(new InvalidAction({ reason: 'missing player identity for claim' }))
  }

  let player: GamePlayer
  try {
    // New players join with zero chips and buy in before playing.
    player = decodePlayer({
      id: context.playerId,
      profileId: profileIdRaw,
      name: context.playerName,
      seatIndex,
      stack: 0,
      handStatus: 'needs-rebuy',
      connection: 'connected',
      sitOutNextHand: false,
      totalBuyInCents: 0,
      totalChipsPurchased: 0,
      pendingRebuyChips: 0,
    })
  } catch {
    return err(new InvalidAction({ reason: 'invalid seat claim payload' }))
  }

  return ok(
    { ...snapshot, players: [...snapshot.players, player] },
    [
      {
        _tag: 'seat-claimed',
        seatIndex: player.seatIndex,
        playerId: player.id,
        profileId: player.profileId,
      },
    ],
  )
}

/** Manual recovery: free a non-live seat so its profile can claim again. */
export function releaseSeat(
  snapshot: GameSnapshot,
  seatIndex: number,
): ReducerResult {
  const player = snapshot.players.find((p) => p.seatIndex === seatIndex)
  if (!player) {
    return err(new InvalidAction({ reason: 'no player on that seat' }))
  }
  if (player.connection === 'connected') {
    return err(
      new InvalidAction({ reason: 'seat has a live connection; cannot release' }),
    )
  }
  return ok(
    {
      ...snapshot,
      players: replacePlayer(snapshot.players, {
        ...player,
        connection: 'released',
      }),
    },
    [{ _tag: 'seat-released', seatIndex: player.seatIndex, playerId: player.id }],
  )
}

/**
 * Visible recovery action (SPEC.md Disconnect behavior): fold an
 * interrupted player who is blocking the hand. Only the due-to-act case is
 * allowed — when the player is not due to act the table can simply wait —
 * and the fold routes through the normal action path so an uncontested
 * finish bundles identically. The audit envelope records the marker.
 */
export function markInterruptedFolded(
  snapshot: GameSnapshot,
  seatIndex: number,
): ReducerResult {
  const player = snapshot.players.find((p) => p.seatIndex === seatIndex)
  if (!player) {
    return err(new InvalidAction({ reason: 'no player on that seat' }))
  }
  if (player.connection === 'connected') {
    return err(
      new InvalidAction({ reason: 'player is connected; they act for themselves' }),
    )
  }
  const hand = snapshot.hand
  if (!hand || snapshot.game.status !== 'in-hand') {
    return err(new InvalidAction({ reason: 'no active hand' }))
  }
  if (hand.activeSeat !== seatIndex) {
    return err(
      new InvalidAction({
        reason: 'player is not due to act; the table can wait',
      }),
    )
  }
  return applyPlayerAction(snapshot, seatIndex, { kind: 'fold' })
}

/** Socket drop: reserve the seat, never fold the player (SPEC.md). */
export function interruptSeat(
  snapshot: GameSnapshot,
  seatIndex: number,
): ReducerResult {
  const player = snapshot.players.find((p) => p.seatIndex === seatIndex)
  if (!player) {
    return err(new InvalidAction({ reason: 'no player on that seat' }))
  }
  if (player.connection !== 'connected') {
    return err(new InvalidAction({ reason: 'seat is not connected' }))
  }
  return ok(
    {
      ...snapshot,
      players: replacePlayer(snapshot.players, {
        ...player,
        connection: 'interrupted',
      }),
    },
    [
      {
        _tag: 'seat-interrupted',
        seatIndex: player.seatIndex,
        playerId: player.id,
      },
    ],
  )
}
