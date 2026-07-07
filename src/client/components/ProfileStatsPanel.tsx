import { useState } from 'react'

import type { ProfileInfo, ProfileStatsInfo } from '../api'
import { formatCents, formatNetCents } from '../view-helpers'

export interface ProfileStatsPanelProps {
  profiles: ProfileInfo[]
  loadStats(profileId: string): Promise<ProfileStatsInfo>
}

/**
 * Session-level stats per local profile (SPEC.md Stats): pick a player,
 * see games played, money totals, extremes, average net, hands, and the
 * per-game settlement summary. No strategy analytics.
 */
export function ProfileStatsPanel({ profiles, loadStats }: ProfileStatsPanelProps) {
  const [stats, setStats] = useState<ProfileStatsInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (profiles.length === 0) {
    return <p className="lede">No player profiles yet.</p>
  }

  return (
    <div className="stats-panel">
      <div className="stats-panel__profiles">
        {profiles.map((profile) => (
          <button
            key={profile.profileId}
            type="button"
            className={
              stats?.profileId === profile.profileId
                ? 'button button--primary'
                : 'button'
            }
            onClick={() =>
              void loadStats(profile.profileId)
                .then(setStats)
                .catch((e: Error) => setError(e.message))
            }
          >
            {profile.name}
          </button>
        ))}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {stats ? (
        <div className="stats-panel__rows">
          <div className="stats-panel__row">
            <span>Games played</span>
            <span>{stats.gamesPlayed}</span>
          </div>
          <div className="stats-panel__row">
            <span>Total buy-ins</span>
            <span>{formatCents(stats.totalBuyInCents)}</span>
          </div>
          <div className="stats-panel__row">
            <span>Total cash-out</span>
            <span>{formatCents(stats.totalCashOutCents)}</span>
          </div>
          <div className="stats-panel__row">
            <span>Net</span>
            <span
              className={
                stats.totalNetCents >= 0 ? 'cash-out__net-win' : 'cash-out__net-loss'
              }
            >
              {formatNetCents(stats.totalNetCents)}
            </span>
          </div>
          <div className="stats-panel__row">
            <span>Biggest win</span>
            <span>{formatNetCents(stats.biggestWinCents)}</span>
          </div>
          <div className="stats-panel__row">
            <span>Biggest loss</span>
            <span>{formatNetCents(stats.biggestLossCents)}</span>
          </div>
          <div className="stats-panel__row">
            <span>Average net per game</span>
            <span>{formatNetCents(stats.averageNetCents)}</span>
          </div>
          <div className="stats-panel__row">
            <span>Hands played</span>
            <span>{stats.totalHandsPlayed}</span>
          </div>
          {stats.games.map((game) => (
            <div key={game.gameId} className="stats-panel__row stats-panel__game">
              <span>
                #{game.code} · {game.handsPlayed} hands
              </span>
              <span>{formatNetCents(game.netCents)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="lede">Pick a player to see session stats.</p>
      )}
    </div>
  )
}
