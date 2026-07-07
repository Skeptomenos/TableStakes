import { useEffect, useState } from 'react'

import type { HistoryGame } from '../api'
import { formatNetCents } from '../view-helpers'

export interface HistoryListProps {
  loadHistory(): Promise<HistoryGame[]>
}

/**
 * Finished games, newest first (SPEC.md Persistence And History): dense
 * rows with the game code, hand count, per-player nets, and whether the
 * settlement was finalized. Finished games are never deleted automatically.
 */
export function HistoryList({ loadHistory }: HistoryListProps) {
  const [games, setGames] = useState<HistoryGame[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadHistory()
      .then((list) => {
        if (!cancelled) setGames(list)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
    // Loaded once when the panel mounts.
  }, [])

  if (error) return <p className="error-text">{error}</p>
  if (games === null) return <p className="lede">Loading past games…</p>
  if (games.length === 0) {
    return <p className="lede">No finished games yet.</p>
  }

  return (
    <ul className="history-list">
      {games.map((game) => (
        <li key={game.gameId} className="history-list__game">
          <div className="history-list__head">
            <span className="history-list__code">#{game.code}</span>
            <span>{new Date(game.finishedAt).toLocaleDateString()}</span>
            <span>{game.handsPlayed} hands</span>
            {game.finalized ? (
              <span className="history-list__settled">Settled</span>
            ) : null}
          </div>
          <div className="history-list__players">
            {game.players.map((player) => (
              <span key={player.profileId} className="history-list__player">
                <span>{player.name}</span>{' '}
                <span
                  className={
                    player.netCents >= 0
                      ? 'cash-out__net-win'
                      : 'cash-out__net-loss'
                  }
                >
                  {formatNetCents(player.netCents)}
                </span>
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}
