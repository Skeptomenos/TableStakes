import { useEffect, useState } from 'react'

import {
  createGame,
  createProfile,
  getHistory,
  getProfiles,
  getProfileStats,
  type ProfileInfo,
} from '../api'
import { HistoryList } from '../components/HistoryList'
import { JoinByCode } from '../components/JoinByCode'
import { ProfileSelector } from '../components/ProfileSelector'
import { ProfileStatsPanel } from '../components/ProfileStatsPanel'
import { navigate } from '../router'
import { rememberProfile } from '../session'

/**
 * Host surface: pick or create a local profile, then start a table. The
 * creating profile is recorded for audit only — no admin role exists.
 */
export function HomeRoute() {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getProfiles().then(setProfiles).catch((e: Error) => setError(e.message))
  }, [])

  async function startTable(profileId: string) {
    if (busy) return
    setBusy(true)
    try {
      const game = await createGame(profileId)
      rememberProfile(game.code, profileId)
      navigate(`/g/${game.code}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <p className="lede">
        Start a table on this laptop; phones on the same Wi-Fi join with a QR
        code.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      <section className="card" aria-label="Join a game">
        <h2 className="card__title">Join a Game</h2>
        <JoinByCode onJoin={(code) => navigate(`/g/${code}`)} />
      </section>
      <ProfileSelector
        profiles={profiles}
        onSelect={(profileId) => void startTable(profileId)}
        onCreate={(name) =>
          void createProfile(name)
            .then((profile) => startTable(profile.profileId))
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
