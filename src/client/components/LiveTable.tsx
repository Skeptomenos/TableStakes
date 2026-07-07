import { useEffect, useRef, useState } from 'react'

import type { GamePlayer, GameSnapshot, Street } from '../../shared/schema/snapshot'
import { bySeatOrder } from '../view-helpers'
import { stadiumLayout } from './table-layout'

export interface LiveTableProps {
  snapshot: GameSnapshot
  mySeat: number | null
}

const FILLED_BY_STREET: Record<Street, number> = {
  'pre-flop': 0,
  flop: 3,
  turn: 4,
  river: 5,
  showdown: 5,
}

// Locked geometry (design uplift decisions 2-4): cards never change size;
// dealer/blind pucks float on the top-left corner; ONE status pill hovers
// over the bottom border.
const CARD_W = 96
const CARD_H = 64

interface Puck {
  label: string
  kind: 'dealer' | 'blind'
}

function pucksFor(snapshot: GameSnapshot, player: GamePlayer): Puck[] {
  const hand = snapshot.hand
  const out: Puck[] = []
  const dealerSeat = hand?.dealerSeat ?? snapshot.game.dealerSeat
  if (dealerSeat === player.seatIndex) out.push({ label: 'D', kind: 'dealer' })
  if (hand?.smallBlindSeat === player.seatIndex) out.push({ label: 'SB', kind: 'blind' })
  if (hand?.bigBlindSeat === player.seatIndex) out.push({ label: 'BB', kind: 'blind' })
  return out
}

interface Status {
  label: string
  kind: string
}

/** The single most important state pill for the bottom border. */
function statusFor(
  snapshot: GameSnapshot,
  player: GamePlayer,
  mySeat: number | null,
): Status | null {
  // A connection problem outranks everything — an interrupted player who
  // is due to act is the hand-blocking case the table must SEE to use the
  // recovery actions (SPEC Disconnect behavior). A "Thinking" pill there
  // would hide the problem.
  if (player.connection === 'interrupted') {
    return { label: 'Interrupted', kind: 'warn' }
  }
  const hand = snapshot.hand
  if (hand?.activeSeat === player.seatIndex) {
    return player.seatIndex === mySeat
      ? { label: 'Your Turn', kind: 'turn' }
      : { label: 'Thinking', kind: 'turn' }
  }
  if (player.handStatus === 'all-in') return { label: 'All-in', kind: 'allin' }
  if (player.handStatus === 'folded') return { label: 'Folded', kind: 'folded' }
  if (player.handStatus === 'sitting-out') {
    return { label: '⏸ Sitting out', kind: 'pause' }
  }
  return null
}

/**
 * The live table (design uplift, locked 2026-07-07): a stadium rail with
 * card centers exactly ON it at equal arc-length steps, hero pinned
 * bottom-center. Fixed-geometry cards; badges float and never resize a
 * card. Layout math lives in table-layout.ts (the ellipse it replaced
 * spaced seats unevenly).
 */
export function LiveTable({ snapshot, mySeat }: LiveTableProps) {
  const hand = snapshot.hand
  const players = bySeatOrder(snapshot.players)
  const areaRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 390, height: 560 })

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const update = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Hero (ring index 0, bottom-center) is the claimed seat; spectators see
  // the first seat in table order there instead.
  const heroIndex = Math.max(
    0,
    players.findIndex((p) => p.seatIndex === mySeat),
  )
  const ring = [...players.slice(heroIndex), ...players.slice(0, heroIndex)]
  const layout = stadiumLayout(ring.length, size.width, size.height)

  const filled = hand ? FILLED_BY_STREET[hand.street] : 0
  const committed = hand?.commitments.reduce((sum, c) => sum + c.total, 0) ?? 0
  const potsTotal = snapshot.pots.reduce((sum, p) => sum + p.amount, 0)
  const liveTotal = committed + potsTotal

  const nameFor = (id: string) =>
    snapshot.players.find((p) => p.id === id)?.name ?? id

  return (
    <div className="table-area" ref={areaRef}>
      <div
        className="table-rail"
        aria-hidden="true"
        style={{
          left: layout.rail.left,
          top: layout.rail.top,
          width: layout.rail.width,
          height: layout.rail.height,
          borderRadius: layout.rail.radius,
        }}
      />
      {ring.map((player, index) => {
        const seat = layout.seats[index]!
        const commitment = hand?.commitments.find(
          (c) => c.seatIndex === player.seatIndex,
        )
        const status = statusFor(snapshot, player, mySeat)
        const isHero = player.seatIndex === mySeat
        return (
          <div
            key={player.id}
            className={isHero ? 'player-card player-card--me' : 'player-card'}
            style={{
              left: seat.x,
              top: seat.y,
              width: `${CARD_W}px`,
              height: `${CARD_H}px`,
            }}
            data-active={hand?.activeSeat === player.seatIndex || undefined}
            data-folded={player.handStatus === 'folded' || undefined}
          >
            {pucksFor(snapshot, player).length > 0 ? (
              <span className="player-card__pucks">
                {pucksFor(snapshot, player).map((puck) => (
                  <span key={puck.label} className={`puck puck--${puck.kind}`}>
                    {puck.label}
                  </span>
                ))}
              </span>
            ) : null}
            <span className="player-card__name">{player.name}</span>
            <span className="player-card__stack">{player.stack}</span>
            {commitment && commitment.street > 0 ? (
              <span className="player-card__bet">Bet {commitment.street}</span>
            ) : null}
            {status ? (
              <span
                className={`player-card__status badge badge--${status.kind}`}
              >
                {status.label}
              </span>
            ) : null}
          </div>
        )
      })}

      <div
        className="table-center"
        style={{ left: layout.center.x, top: layout.center.y }}
      >
        <div className="community" aria-label="Community cards">
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={
                i < filled
                  ? 'community__slot community__slot--filled'
                  : 'community__slot'
              }
            />
          ))}
        </div>
        <div className="pots">
          {snapshot.pots.length > 0 ? (
            snapshot.pots.map((pot, index) => (
              <div
                key={pot.id}
                className={index === 0 ? 'pots__row pots__row--main' : 'pots__row'}
              >
                <span className="pots__label">{pot.label}</span>
                <span className="pots__amount">{pot.amount}</span>
                <span className="pots__eligible">
                  {pot.eligiblePlayerIds.map(nameFor).join(', ')}
                </span>
              </div>
            ))
          ) : (
            <div className="pots__row pots__row--main">
              <span className="pots__label">Main Pot</span>
              <span className="pots__amount">{liveTotal}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
