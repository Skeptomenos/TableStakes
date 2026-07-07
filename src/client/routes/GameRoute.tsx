import { useEffect, useMemo, useRef, useState, type JSX } from 'react'

import type { GameSnapshot } from '../../shared/schema/snapshot'
import {
  createProfile,
  getProfiles,
  getServerInfo,
  getSettlement,
  type ProfileInfo,
  type ServerInfo,
} from '../api'
import { CashOutScreen } from '../components/CashOutScreen'
import { ProfileSelector } from '../components/ProfileSelector'
import { SeatList } from '../components/SeatList'
import { SetupForm, type SetupPayload } from '../components/SetupForm'
import { ShareCard } from '../components/ShareCard'
import { TableScreen } from '../components/TableScreen'
import { connectToGame, type GameConnection } from '../socket-client'
import { recallProfile, rememberProfile, sessionId } from '../session'
import { bySeatOrder } from '../view-helpers'

export interface GameRouteProps {
  code: string
}

/**
 * The per-game flow for the setup phase: connect, pick a profile, claim a
 * seat, complete first-hand setup. Live play arrives in the next slice.
 */
export function GameRoute({ code }: GameRouteProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [profileId, setProfileId] = useState<string | null>(() =>
    recallProfile(code),
  )
  const [mySeat, setMySeat] = useState<number | null>(null)
  const [setupSubmitted, setSetupSubmitted] = useState(false)
  const connectionRef = useRef<GameConnection | null>(null)

  useEffect(() => {
    const connection = connectToGame(code, sessionId())
    connectionRef.current = connection
    connection.onSnapshot(setSnapshot)
    connection.onJoinError(setJoinError)
    getProfiles().then(setProfiles).catch(() => setProfiles([]))
    getServerInfo().then(setServerInfo).catch(() => setServerInfo(null))
    return () => connection.disconnect()
  }, [code])

  const shareCard = useMemo(
    () => (
      <ShareCard
        code={code}
        port={window.location.port || '80'}
        addresses={serverInfo?.addresses ?? []}
      />
    ),
    [code, serverInfo],
  )

  async function send(command: unknown): Promise<boolean> {
    setCommandError(null)
    try {
      await connectionRef.current!.sendCommand(command)
      return true
    } catch (e) {
      setCommandError((e as Error).message)
      return false
    }
  }

  async function claimSeat(seatIndex: number) {
    if (!profileId) return
    const ok = await send({ _tag: 'claim-seat', seatIndex, profileId })
    if (ok) {
      setMySeat(seatIndex)
      rememberProfile(code, profileId)
    }
  }

  async function completeSetup(payload: SetupPayload) {
    if (!snapshot) return
    if (!(await send({ _tag: 'configure-game', settings: payload.settings }))) return
    if (!(await send({ _tag: 'set-dealer', seatIndex: payload.dealerSeat }))) return
    // Default buy-in for every seated player still without chips.
    for (const player of bySeatOrder(snapshot.players)) {
      if (player.stack === 0) {
        const ok = await send({
          _tag: 'record-buy-in',
          playerId: player.id,
          money: {
            currency: payload.settings.currency,
            cents: payload.settings.defaultBuyInCents,
          },
          chips: payload.settings.defaultStack,
        })
        if (!ok) return
      }
    }
    setSetupSubmitted(true)
  }

  if (joinError) {
    return <p className="error-text">Could not join: {joinError}</p>
  }
  if (!snapshot) {
    return <p className="lede">Connecting to table {code}…</p>
  }

  const status = snapshot.game.status
  const seated = bySeatOrder(snapshot.players)

  // Live play takes over the whole viewport once the game leaves setup.
  if (status === 'in-hand' || status === 'showdown' || status === 'between-hands') {
    return (
      <TableScreen
        snapshot={snapshot}
        mySeat={mySeat}
        error={commandError}
        onCommand={(command) => void send(command)}
      />
    )
  }

  // End of night: buy-ins, cash-out values, and editable payments.
  if (status === 'finished') {
    return (
      <div className="stack">
        {commandError ? <p className="error-text">{commandError}</p> : null}
        <CashOutScreen
          snapshot={snapshot}
          onCommand={send}
          loadSettlement={() => getSettlement(code)}
        />
      </div>
    )
  }

  let phase: JSX.Element
  if (!profileId) {
    phase = (
      <>
        <h2 className="route-title">Join Local Game</h2>
        <ProfileSelector
          profiles={profiles}
          onSelect={setProfileId}
          onCreate={(name) =>
            void createProfile(name)
              .then((profile) => {
                setProfiles((prev) => [...prev, profile])
                setProfileId(profile.profileId)
              })
              .catch((e: Error) => setCommandError(e.message))
          }
        />
      </>
    )
  } else if (mySeat === null) {
    phase = (
      <>
        <h2 className="route-title">Join Local Game</h2>
        <SeatList snapshot={snapshot} onClaim={(seat) => void claimSeat(seat)} />
      </>
    )
  } else if (status === 'setup' && !setupSubmitted) {
    phase = <SetupForm snapshot={snapshot} onStart={(p) => void completeSetup(p)} />
  } else {
    phase = (
      <section className="card" aria-label="Table status">
        <h2 className="card__title">Table is set</h2>
        <p>{seated.length} players seated. Start the first hand when the
          table is ready.</p>
        <ul className="seat-list">
          {seated.map((player) => (
            <li key={player.id} className="seat-list__row">
              <span className="seat-list__name">{player.name}</span>
              <span className="seat-list__stack">{player.stack}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="button button--primary"
          disabled={seated.filter((p) => p.stack > 0).length < 2}
          onClick={() => void send({ _tag: 'start-hand' })}
        >
          Start Hand
        </button>
      </section>
    )
  }

  return (
    <div className="stack">
      {commandError ? <p className="error-text">{commandError}</p> : null}
      {phase}
      {status === 'setup' ? shareCard : null}
    </div>
  )
}
