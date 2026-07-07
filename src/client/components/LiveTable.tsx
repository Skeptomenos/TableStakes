import type { GamePlayer, GameSnapshot, Street } from '../../shared/schema/snapshot'
import { bySeatOrder } from '../view-helpers'

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

function badges(
  snapshot: GameSnapshot,
  player: GamePlayer,
  mySeat: number | null,
): { label: string; kind: string }[] {
  const hand = snapshot.hand
  const settings = snapshot.game.settings
  const out: { label: string; kind: string }[] = []
  const dealerSeat = hand?.dealerSeat ?? snapshot.game.dealerSeat
  if (dealerSeat === player.seatIndex) out.push({ label: 'D', kind: 'dealer' })
  if (hand?.smallBlindSeat === player.seatIndex) {
    out.push({ label: `SB ${settings.smallBlind}`, kind: 'blind' })
  }
  if (hand?.bigBlindSeat === player.seatIndex) {
    out.push({ label: `BB ${settings.bigBlind}`, kind: 'blind' })
  }
  if (hand?.activeSeat === player.seatIndex) {
    out.push(
      player.seatIndex === mySeat
        ? { label: 'Your Turn', kind: 'active' }
        : { label: 'Thinking', kind: 'active' },
    )
  }
  if (player.handStatus === 'folded') out.push({ label: 'Folded', kind: 'muted' })
  if (player.handStatus === 'all-in') out.push({ label: 'All-In', kind: 'danger' })
  if (player.handStatus === 'sitting-out') {
    // Deliberate pause: pause glyph + muted tone, visually distinct from
    // the amber connection-problem badge below (DESIGN.md Live Table).
    out.push({ label: '⏸ Sitting out', kind: 'pause' })
  }
  if (player.connection === 'interrupted') {
    out.push({ label: 'Interrupted', kind: 'warn' })
  }
  return out
}

/**
 * The live table: a simple oval with player cards around it and a compact
 * center stack of community placeholders plus pots (DESIGN.md Live Table /
 * Street And Pot Center). The pot total is live — it includes chips
 * committed on the current street.
 */
export function LiveTable({ snapshot, mySeat }: LiveTableProps) {
  const hand = snapshot.hand
  const players = bySeatOrder(snapshot.players)
  const myIndex = Math.max(
    0,
    players.findIndex((p) => p.seatIndex === mySeat),
  )
  const filled = hand ? FILLED_BY_STREET[hand.street] : 0

  const committed =
    hand?.commitments.reduce((sum, c) => sum + c.total, 0) ?? 0
  const potsTotal = snapshot.pots.reduce((sum, p) => sum + p.amount, 0)
  const liveTotal = committed + potsTotal

  const nameFor = (id: string) =>
    snapshot.players.find((p) => p.id === id)?.name ?? id

  return (
    <div className="table-area">
      <div className="table-oval" aria-hidden="true" />
      {players.map((player, index) => {
        const angle =
          ((index - myIndex) / players.length) * 2 * Math.PI + Math.PI / 2
        const left = 50 + 41 * Math.cos(angle)
        const top = 50 + 40 * Math.sin(angle)
        const commitment = hand?.commitments.find(
          (c) => c.seatIndex === player.seatIndex,
        )
        return (
          <div
            key={player.id}
            className={
              player.seatIndex === mySeat
                ? 'player-card player-card--me'
                : 'player-card'
            }
            style={{ left: `${left}%`, top: `${top}%` }}
            data-active={hand?.activeSeat === player.seatIndex || undefined}
            data-folded={player.handStatus === 'folded' || undefined}
          >
            <span className="player-card__name">{player.name}</span>
            <span className="player-card__stack">{player.stack}</span>
            {commitment && commitment.street > 0 ? (
              <span className="player-card__bet">Bet: {commitment.street}</span>
            ) : null}
            <span className="player-card__badges">
              {badges(snapshot, player, mySeat).map((badge) => (
                <span key={badge.label} className={`badge badge--${badge.kind}`}>
                  {badge.label}
                </span>
              ))}
            </span>
          </div>
        )
      })}

      <div className="table-center">
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
            snapshot.pots.map((pot) => (
              <div key={pot.id} className="pots__row">
                <span className="pots__label">{pot.label}</span>
                <span className="pots__amount">{pot.amount}</span>
                <span className="pots__eligible">
                  {pot.eligiblePlayerIds.map(nameFor).join(', ')}
                </span>
              </div>
            ))
          ) : (
            <div className="pots__row">
              <span className="pots__label">Main Pot</span>
              <span className="pots__amount">{liveTotal}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
