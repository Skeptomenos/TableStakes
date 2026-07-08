import type { GamePlayer, GameSnapshot } from '../../shared/schema/snapshot'

export interface SeatOverviewProps {
  snapshot: GameSnapshot
}

const SEAT_COUNT = 10

function statusFor(player: GamePlayer | undefined): string {
  if (!player) return '[Empty]'
  if (player.stack === 0) return `${player.name} — waiting to buy in`
  return player.name
}

/**
 * Read-only seat overview for the console (DESIGN.md Console After
 * Creation): seat 1 through seat 10, `[Empty]` rows filling live as
 * players claim and buy in. The console watches; it never claims a seat
 * from this view — the laptop may still legitimately play by opening
 * `/g/<code>` itself (ADR 0002: console-primary, never console-exclusive).
 */
export function SeatOverview({ snapshot }: SeatOverviewProps) {
  const bySeat = new Map(snapshot.players.map((p) => [Number(p.seatIndex), p]))

  return (
    <section className="card" aria-label="Seat overview">
      <h2 className="card__title">Seats</h2>
      <ul className="seat-list">
        {Array.from({ length: SEAT_COUNT }, (_, seatIndex) => {
          const player = bySeat.get(seatIndex)
          return (
            <li key={seatIndex} className="seat-list__row">
              <span className="seat-list__seat">
                <span className="seat-list__no">{seatIndex + 1}</span>
                <span className="seat-list__seat-word">Seat</span>
              </span>
              <span className="seat-list__name">{statusFor(player)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
