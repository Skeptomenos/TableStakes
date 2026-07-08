import { useEffect, useState } from 'react'

import {
  createProfile,
  getHistory,
  getProfiles,
  getProfileStats,
  listGames,
  type ActiveGameInfo,
  type ProfileInfo,
} from '../api'
import { ActiveTablesList } from '../components/ActiveTablesList'
import { HistoryList } from '../components/HistoryList'
import { JoinByCode } from '../components/JoinByCode'
import { ProfileSelector } from '../components/ProfileSelector'
import { ProfileStatsPanel } from '../components/ProfileStatsPanel'
import { navigate } from '../router'
import { rememberLastProfile } from '../session'

/**
 * Player landing (ADR 0002, SPEC.md): join by code, tap-to-join active
 * tables, and a select-only profile picker. No player surface can create
 * a table — selecting a profile only writes a reconnect hint, never
 * navigates or creates anything.
 */
export function HomeRoute() {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [games, setGames] = useState<ActiveGameInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getProfiles().then(setProfiles).catch((e: Error) => setError(e.message))
    listGames().then(setGames).catch(() => setGames([]))
  }, [])

  return (
    <div className="stack">
      <p className="lede">
        Join a table on this Wi-Fi: scan the console's QR, type its code, or
        tap it below.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      <section className="card" aria-label="Join a game">
        <h2 className="card__title">Join a Game</h2>
        <JoinByCode onJoin={(code) => navigate(`/g/${code}`)} />
        <ActiveTablesList
          games={games}
          onJoin={(code) => navigate(`/g/${code}`)}
        />
      </section>
      <ProfileSelector
        profiles={profiles}
        onSelect={rememberLastProfile}
        onCreate={(name) =>
          void createProfile(name)
            .then((profile) => {
              setProfiles((prev) => [...prev, profile])
              rememberLastProfile(profile.profileId)
            })
            .catch((e: Error) => setError(e.message))
        }
      />
      <section className="card" aria-label="Past games">
        <h2 className="card__title">Past Games</h2>
        <HistoryList loadHistory={getHistory} />
      </section>
      <section className="card" aria-label="Player stats">
        <h2 className="card__title">Player Stats</h2>
        <ProfileStatsPanel profiles={profiles} loadStats={getProfileStats} />
      </section>
    </div>
  )
}
