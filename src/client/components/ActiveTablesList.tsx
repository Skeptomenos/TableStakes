import type { ActiveGameInfo } from '../api'

export interface ActiveTablesListProps {
  games: ActiveGameInfo[]
  onJoin(code: string): void
}

/**
 * Tap-to-join active tables (ADR 0002, DESIGN.md Join And Seat Selection):
 * one row per open table — code and seated count — so a second device
 * finds the existing table instead of creating its own (the exact
 * 2026-07-08 two-device failure). No creation affordance here or anywhere
 * on a player surface.
 */
export function ActiveTablesList({ games, onJoin }: ActiveTablesListProps) {
  if (games.length === 0) {
    return <p className="lede">No open tables yet.</p>
  }

  return (
    <ul className="active-tables-list">
      {games.map((game) => (
        <li key={game.code} className="active-tables-list__row">
          <button
            type="button"
            className="active-tables-list__button"
            onClick={() => onJoin(game.code)}
          >
            <span className="active-tables-list__code">#{game.code}</span>
            <span className="active-tables-list__seated">
              {game.seatedCount} seated
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
