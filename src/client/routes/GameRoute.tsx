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
import { BuyInConfirm } from '../components/BuyInConfirm'
import { CashOutScreen } from '../components/CashOutScreen'
import { ProfileSelector } from '../components/ProfileSelector'
import { SeatList } from '../components/SeatList'
import { ShareCard } from '../components/ShareCard'
import { TableScreen } from '../components/TableScreen'
import { connectToGame, type GameConnection } from '../socket-client'
import { recallProfile, rememberProfile, sessionId } from '../session'
import { bySeatOrder } from '../view-helpers'

export interface GameRouteProps {
  code: string
}

/**
 * The per-game phone flow (ADR 0002): connect, pick a profile, claim a
 * seat, confirm the fixed default buy-in, wait for the table. Table
 * lifecycle (settings, dealer pick) lives on the console — this route
 * never configures the game or picks the dealer itself, though phone-side
 * Start Hand stays available once the table is ready (console-primary,
 * not console-exclusive).
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

  async function confirmBuyIn(player: NonNullable<ReturnType<typeof myPlayerOf>>) {
    if (!snapshot) return
    const { defaultBuyInCents, defaultStack, currency } = snapshot.game.settings
    await send({
      _tag: 'record-buy-in',
      playerId: player.id,
      money: { currency, cents: defaultBuyInCents },
      chips: defaultStack,
    })
  }

  function myPlayerOf(s: GameSnapshot) {
    return s.players.find((p) => p.seatIndex === mySeat) ?? null
  }

  if (joinError) {
    return <p className="error-text">Could not join: {joinError}</p>
  }
  if (!snapshot) {
    return <p className="lede">Connecting to table {code}…</p>
  }

  const status = snapshot.game.status
  const seated = bySeatOrder(snapshot.players)
  const myPlayer = myPlayerOf(snapshot)

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
  } else if (myPlayer && myPlayer.stack === 0) {
    // Reclaiming a seat that already has chips skips this phase — only a
    // never-bought-in seat (stack === 0) needs the confirmation (ADR 0002).
    phase = (
      <BuyInConfirm
        settings={snapshot.game.settings}
        onConfirm={() => void confirmBuyIn(myPlayer)}
      />
    )
  } else {
    const boughtIn = seated.filter((p) => p.stack > 0)
    const canStart = boughtIn.length >= 2
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
          disabled={!canStart}
          onClick={() => void send({ _tag: 'start-hand' })}
        >
          Start Hand
        </button>
        {!canStart ? (
          <p className="lede">Waiting for a second player to buy in.</p>
        ) : null}
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
