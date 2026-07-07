import type { GamePlayer, GameSnapshot } from '../../shared/schema/snapshot'

export interface SeatListProps {
  snapshot: GameSnapshot
  onClaim(seatIndex: number): void
}

const SEAT_COUNT = 10

// Lock icon on locked seats (DESIGN.md seat claiming states). Inline SVG:
// no icon dependency, and aria-hidden because the `Locked` text carries
// the meaning.
function LockIcon() {
  return (
    <svg
      className="seat-list__lock"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
    </svg>
  )
}

function seatState(player: GamePlayer | undefined): {
  label: string
  action: 'claim' | 'reclaim' | 'locked'
} {
  if (!player) return { label: 'Claim Seat', action: 'claim' }
  switch (player.connection) {
    case 'connected':
      return { label: 'Locked', action: 'locked' }
    case 'interrupted':
      return { label: 'Reclaim', action: 'reclaim' }
    case 'reserved':
      return { label: 'Reclaim', action: 'reclaim' }
    case 'released':
      return { label: 'Claim Seat', action: 'claim' }
  }
}

/**
 * Seat claiming per SPEC.md: active seats locked, interrupted seats
 * recoverable (amber), released and empty seats claimable. No PIN,
 * password, or token surfaces exist anywhere in this flow.
 */
export function SeatList({ snapshot, onClaim }: SeatListProps) {
  const bySeat = new Map(snapshot.players.map((p) => [Number(p.seatIndex), p]))

  return (
    <section className="card" aria-label="Seats">
      <h2 className="card__title">Claim a seat</h2>
      <ul className="seat-list">
        {Array.from({ length: SEAT_COUNT }, (_, seatIndex) => {
          const player = bySeat.get(seatIndex)
          const state = seatState(player)
          return (
            <li key={seatIndex} className="seat-list__row">
              <span className="seat-list__seat">Seat {seatIndex + 1}</span>
              <span className="seat-list__name">
                {player ? player.name : '[Empty]'}
              </span>
              {state.action === 'locked' ? (
                <span className="badge badge--locked">
                  <LockIcon />
                  {state.label}
                </span>
              ) : (
                <button
                  type="button"
                  className={
                    state.action === 'reclaim'
                      ? 'button button--amber'
                      : 'button'
                  }
                  onClick={() => onClaim(seatIndex)}
                >
                  {state.label}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
