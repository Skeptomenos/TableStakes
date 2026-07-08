import { useEffect, useMemo, useRef, useState } from 'react'

import type { GameSnapshot } from '../../shared/schema/snapshot'
import {
  createGame,
  getHistory,
  getProfiles,
  getProfileStats,
  getServerInfo,
  listGames,
  type ActiveGameInfo,
  type ProfileInfo,
  type ServerInfo,
} from '../api'
import { ConsoleCreateForm, type ConsoleSettingsPayload } from '../components/ConsoleCreateForm'
import { HistoryList } from '../components/HistoryList'
import { ProfileStatsPanel } from '../components/ProfileStatsPanel'
import { SeatOverview } from '../components/SeatOverview'
import { ShareCard } from '../components/ShareCard'
import { connectToGame, type GameConnection } from '../socket-client'
import { sessionId } from '../session'
import { bySeatOrder } from '../view-helpers'

/**
 * One active table's console view (DESIGN.md Console After Creation):
 * permanent share card, live seat overview, and — once 2+ players have
 * bought in — a dealer pick and Start Hand. Connects as a spectator: the
 * console watches and configures but never claims a seat here (SeatOverview
 * decision log, Slice 3) — the laptop may still legitimately play by
 * opening /g/<code> itself (ADR 0002: console-primary, never
 * console-exclusive).
 */
function ConsoleTable({ code }: { code: string }) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null)
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [dealerSeat, setDealerSeat] = useState<number | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const connectionRef = useRef<GameConnection | null>(null)

  useEffect(() => {
    const connection = connectToGame(code, sessionId())
    connectionRef.current = connection
    connection.onSnapshot(setSnapshot)
    getServerInfo().then(setServerInfo).catch(() => setServerInfo(null))
    return () => connection.disconnect()
  }, [code])

  useEffect(() => {
    if (snapshot?.game.dealerSeat !== null && snapshot?.game.dealerSeat !== undefined) {
      setDealerSeat(snapshot.game.dealerSeat)
    }
  }, [snapshot?.game.dealerSeat])

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

  async function startHand() {
    if (dealerSeat === null) return
    if (!(await send({ _tag: 'set-dealer', seatIndex: dealerSeat }))) return
    await send({ _tag: 'start-hand' })
  }

  if (!snapshot) {
    return <p className="lede">Connecting to table {code}…</p>
  }

  const seated = bySeatOrder(snapshot.players)
  const boughtIn = seated.filter((p) => p.stack > 0)
  const canStart = boughtIn.length >= 2 && dealerSeat !== null

  return (
    <div className="stack">
      {commandError ? <p className="error-text">{commandError}</p> : null}
      <ShareCard
        code={code}
        port={window.location.port || '80'}
        addresses={serverInfo?.addresses ?? []}
      />
      <SeatOverview snapshot={snapshot} />
      {boughtIn.length >= 2 ? (
        <section className="card" aria-label="First dealer">
          <h2 className="card__title">First dealer</h2>
          <fieldset className="dealer-select">
            <legend>Dealer</legend>
            {boughtIn.map((player) => (
              <label key={player.id} className="dealer-select__row">
                <input
                  type="radio"
                  name="dealer"
                  checked={dealerSeat === Number(player.seatIndex)}
                  onChange={() => setDealerSeat(Number(player.seatIndex))}
                />
                <span>{player.name}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="button button--primary"
            disabled={!canStart}
            onClick={() => void startHand()}
          >
            Start Hand
          </button>
        </section>
      ) : (
        <p className="lede">Waiting for a second player to buy in.</p>
      )}
    </div>
  )
}

/**
 * The table console (`/console`, ADR 0002): table lifecycle only — create,
 * configure, share, watch seats fill, pick the first dealer, start the
 * first hand. No buy-ins and no phone-side setup live here. Multiple
 * active tables show a simple list, newest first, with the create form
 * always available below (Decision Log, Slice 3).
 */
export function ConsoleRoute() {
  const [games, setGames] = useState<ActiveGameInfo[] | null>(null)
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function refreshGames() {
    listGames()
      .then((list) => {
        setGames(list)
        // Newest first; keep watching the just-created table by default.
        // Functional form: a slow-resolving refresh (e.g. the mount-time
        // load racing a fast create-and-select) must never clobber a
        // selection made in the meantime with a stale "no selection yet"
        // read.
        setSelectedCode((current) =>
          current === null && list.length > 0
            ? list[list.length - 1]!.code
            : current,
        )
      })
      .catch((e: Error) => setError(e.message))
  }

  // Loaded once on mount; the selected table's own socket keeps its
  // snapshot live, this list only needs to reflect NEW tables appearing.
  useEffect(() => {
    refreshGames()
    getProfiles().then(setProfiles).catch(() => setProfiles([]))
  }, [])

  async function createTable(settings: ConsoleSettingsPayload) {
    try {
      const game = await createGame()
      // A fresh connection just to configure: sendCommand resolves on the
      // server's command-ack, so the settings are durable before
      // ConsoleTable opens its own connection and renders them.
      const connection = connectToGame(game.code, sessionId())
      await connection.sendCommand({ _tag: 'configure-game', settings })
      connection.disconnect()
      setSelectedCode(game.code)
      refreshGames()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const newestFirst = useMemo(
    () => [...(games ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [games],
  )

  return (
    <div className="stack">
      <p className="lede">
        This is the table. Set the buy-in and blinds, then share the QR with
        your players.
      </p>
      {error ? <p className="error-text">{error}</p> : null}

      {newestFirst.length > 1 ? (
        <section className="card" aria-label="Active tables">
          <h2 className="card__title">Active tables</h2>
          <ul className="active-tables-list">
            {newestFirst.map((game) => (
              <li key={game.code} className="active-tables-list__row">
                <button
                  type="button"
                  className="active-tables-list__button"
                  onClick={() => setSelectedCode(game.code)}
                >
                  <span className="active-tables-list__code">
                    #{game.code}
                  </span>
                  <span className="active-tables-list__seated">
                    {game.seatedCount} seated
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selectedCode ? (
        <ConsoleTable key={selectedCode} code={selectedCode} />
      ) : null}

      <ConsoleCreateForm onCreate={(settings) => void createTable(settings)} />

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
