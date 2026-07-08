import { Effect } from 'effect'

import { computeCashOut } from '../domain/cash-out'
import { interruptSeat } from '../domain/seats'
import {
  aggregateProfileStats,
  type ProfileStats,
} from '../domain/stats'
import { nonUndoableReason } from '../domain/undo'
import type { ReducerOk } from '../domain/result'
import {
  describeEvents,
  type VisibleTransaction,
} from '../domain/visible-transactions'
import type { EventEnvelope, GameEvent } from '../shared/schema/events'
import {
  EpochMillis,
  EventId,
  GameId,
  HandId,
  ProfileId,
  VisibleTransactionId,
} from '../shared/schema/ids'
import type { GameSnapshot } from '../shared/schema/snapshot'
import { runCommandPipeline } from './command-handler'
import type { AppDatabase } from './persistence/db'
import { appendEvents } from './persistence/event-store'
import {
  archiveFinishedGame,
  getCashSettlement,
  listFinishedGameRows,
  type CashSettlementRow,
  type FinishedGameRow,
} from './persistence/finished-game-store'
import { createGameWithUniqueCode } from './persistence/game-store'
import {
  createProfile as insertProfile,
  getProfile,
  listProfiles,
  type ProfileRow,
} from './persistence/profile-store'
import { saveSnapshot } from './persistence/snapshot-store'
import {
  latestTransactionRow,
  snapshotAtSeq,
  snapshotBeforeSeq,
  transactionEvents,
} from './persistence/vtx-store'
import { restoreActiveGames } from './restore'
import { noopLogger, type Logger } from './logger'
import type { Clock, CodeGenerator, IdGenerator } from './services'
import { Cause, Schema } from 'effect'
import { GameSnapshot as GameSnapshotSchema } from '../shared/schema/snapshot'

const decodeSnapshot = Schema.decodeUnknownSync(GameSnapshotSchema)

export interface Broadcaster {
  emitSnapshot(gameId: string, snapshot: GameSnapshot): void
  emitEvents(gameId: string, envelopes: EventEnvelope[]): void
  emitPresence(
    gameId: string,
    presence: { seatIndex: number; connection: string }[],
  ): void
}

export interface SessionRef {
  gameCode: string
  sessionId: string
  socketId: string
}

export type CommandOutcome =
  | { status: 'ack'; id: string }
  | { status: 'rejected'; id: string; reason: string }

interface SeatClaim {
  seatIndex: number
  playerId: string
  profileId: string
  sessionId: string
  socketId: string | null
}

interface GameRuntime {
  gameId: string
  code: string
  snapshot: GameSnapshot
  claims: Map<number, SeatClaim>
}

export interface GameServiceDeps {
  db: AppDatabase
  clock: Clock
  ids: IdGenerator
  codes: CodeGenerator
  broadcaster: Broadcaster
  logger?: Logger
}

export interface HistoryEntry {
  gameId: string
  code: string
  finishedAt: number
  handsPlayed: number
  finalized: boolean
  settlement: FinishedGameRow['settlement']
  players: {
    profileId: string
    name: string
    buyInCents: number
    cashOutCents: number
    netCents: number
  }[]
}

function toHistoryEntry(
  row: FinishedGameRow,
  settlement: CashSettlementRow | null,
): HistoryEntry {
  const summary = computeCashOut(row.finalSnapshot)
  // One row per person: multiple seats held by a profile aggregate.
  const byProfile = new Map<string, HistoryEntry['players'][number]>()
  for (const player of summary.players) {
    const existing = byProfile.get(player.profileId)
    if (existing) {
      existing.buyInCents += player.buyInCents
      existing.cashOutCents += player.cashOutCents
      existing.netCents += player.netCents
      continue
    }
    byProfile.set(player.profileId, {
      profileId: player.profileId,
      name:
        row.finalSnapshot.players.find((p) => p.profileId === player.profileId)
          ?.name ?? player.profileId,
      buyInCents: player.buyInCents,
      cashOutCents: player.cashOutCents,
      netCents: player.netCents,
    })
  }
  return {
    gameId: row.gameId,
    code: row.finalSnapshot.game.code,
    finishedAt: row.finishedAt,
    handsPlayed: row.finalSnapshot.game.lastHandNumber,
    finalized: settlement !== null,
    settlement: {
      totalBuyInCents: row.settlement.totalBuyInCents,
      // Once the table finalized (possibly edited) payments, history must
      // show THOSE — the archive-time suggestion is only the fallback
      // (PR #183 review).
      transfers: settlement?.transfers ?? row.settlement.transfers,
    },
    players: [...byProfile.values()],
  }
}

const PRESENCE_EVENTS: ReadonlySet<GameEvent['_tag']> = new Set([
  'seat-claimed',
  'seat-reconnected',
  'seat-released',
  'seat-interrupted',
  // An undo can restore a snapshot with different seat composition or
  // connection states, so presence must resync too.
  'undo-committed',
])

/**
 * In-memory authority over active games. Commands run strictly one at a
 * time per process (synchronous pipeline + synchronous SQLite), so
 * per-game ordering needs no extra queueing. Every accepted command is
 * durable in SQLite before any broadcast or ack leaves the server.
 */
export class GameService {
  private readonly games = new Map<string, GameRuntime>()
  private readonly byCode = new Map<string, string>()
  private readonly sockets = new Map<string, { gameId: string; sessionId: string }>()
  private readonly log: Logger

  constructor(private readonly deps: GameServiceDeps) {
    this.log = deps.logger ?? noopLogger
    let interruptedSeats = 0
    for (const restored of restoreActiveGames(deps.db)) {
      this.games.set(restored.gameId, {
        gameId: restored.gameId,
        code: restored.code,
        snapshot: restored.snapshot,
        claims: new Map(),
      })
      this.byCode.set(restored.code, restored.gameId)
      interruptedSeats += restored.snapshot.players.filter(
        (p) => p.connection === 'interrupted',
      ).length
    }
    if (this.games.size > 0) {
      this.log.info('server.restore', 'restored active games', {
        games: this.games.size,
        interruptedSeats,
      })
    }
  }

  gameCount(): number {
    return this.games.size
  }

  createProfile(name: string): { profileId: string; name: string } {
    const profileId = this.deps.ids.nextId('profile')
    insertProfile(this.deps.db, { profileId, name, now: this.deps.clock.now() })
    return { profileId, name }
  }

  listProfiles(): ProfileRow[] {
    return listProfiles(this.deps.db)
  }

  findGameByCode(code: string): { gameId: string; code: string; status: string } | null {
    const gameId = this.byCode.get(code)
    const runtime = gameId ? this.games.get(gameId) : undefined
    if (!runtime) return null
    return { gameId: runtime.gameId, code: runtime.code, status: runtime.snapshot.game.status }
  }

  /**
   * Active tables for the player landing's tap-to-join list (SPEC.md,
   * ADR 0002): a second device must find an existing table instead of
   * seeing ten empty seats at a table of its own. A finished game's
   * runtime entry stays in `this.games` for the rest of the process
   * (archived to SQLite, but never evicted from the in-memory map — see
   * `persistAndBroadcast`), so `finished` is filtered here explicitly.
   * Seated count comes from claimed seats in the live snapshot, oldest
   * first.
   */
  listGames(): { code: string; status: string; seatedCount: number; createdAt: number }[] {
    return [...this.games.values()]
      .filter((runtime) => runtime.snapshot.game.status !== 'finished')
      .map((runtime) => ({
        code: runtime.code,
        status: runtime.snapshot.game.status,
        seatedCount: runtime.snapshot.players.length,
        createdAt: runtime.snapshot.game.createdAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  createGame(options: { creatorName?: string; creatorProfileId?: string }): {
    gameId: string
    code: string
    creatorProfileId: string | null
  } {
    // No profile given at all (ADR 0002): the console creates a table
    // without selecting or creating one — the audit records console
    // origin (null) instead of a creator.
    let creator: { profileId: string } | null
    if (options.creatorProfileId) {
      const existing = getProfile(this.deps.db, options.creatorProfileId)
      if (!existing) {
        throw new Error('unknown creator profile')
      }
      creator = existing
    } else if (options.creatorName) {
      creator = this.createProfile(options.creatorName)
    } else {
      creator = null
    }
    const now = this.deps.clock.now()
    const row = createGameWithUniqueCode(this.deps.db, {
      gameId: this.deps.ids.nextId('game'),
      creatorProfileId: creator?.profileId ?? null,
      generateCode: () => this.deps.codes.nextCode(),
      now,
    })

    const snapshot = decodeSnapshot({
      game: {
        id: row.gameId,
        code: row.code,
        status: 'setup',
        settings: {
          currency: 'EUR',
          defaultBuyInCents: 1000,
          defaultStack: 1000,
          smallBlind: 50,
          bigBlind: 100,
          strictMode: false,
          raiseRule: 'any',
          amountStep: { kind: 'follow-small-blind' },
        },
        creatorProfileId: creator?.profileId ?? null,
        dealerSeat: null,
        pendingSettings: null,
        lastHandNumber: 0,
        createdAt: now,
        updatedAt: now,
      },
      players: [],
      hand: null,
      pots: [],
      eventCursor: 0,
    })

    const runtime: GameRuntime = {
      gameId: row.gameId,
      code: row.code,
      snapshot,
      claims: new Map(),
    }
    this.games.set(row.gameId, runtime)
    this.byCode.set(row.code, row.gameId)

    this.persistAndBroadcast(runtime, null, {
      snapshot,
      events: [
        {
          _tag: 'game-created',
          code: snapshot.game.code,
          creatorProfileId: snapshot.game.creatorProfileId,
        },
      ],
      warnings: [],
      ok: true,
    })
    return {
      gameId: row.gameId,
      code: row.code,
      creatorProfileId: creator?.profileId ?? null,
    }
  }

  getSnapshot(gameId: string): GameSnapshot | null {
    return this.games.get(gameId)?.snapshot ?? null
  }

  /**
   * What confirming undo would reverse: the latest visible transaction's
   * label and event tags (SPEC.md Undo: "shows what will be reversed").
   * Null when there is no previous state at all (game-created); a
   * transaction the reducer would refuse to undo is still returned, marked
   * `undoable: false` with the reason, so the drawer explains instead of
   * advertising a confirm that must fail (PR #182 review).
   */
  undoPreview(gameId: string): {
    transactionId: string
    label: string
    events: string[]
    undoable: boolean
    reason?: string
  } | null {
    if (!this.games.has(gameId)) return null
    const transaction = this.loadLatestTransaction(gameId)
    if (!transaction) return null
    const nonUndoable = nonUndoableReason(transaction.events)
    return {
      transactionId: transaction.id,
      label: transaction.label,
      events: transaction.events.map((event) => event._tag),
      undoable: nonUndoable === null,
      ...(nonUndoable === null ? {} : { reason: nonUndoable }),
    }
  }

  /**
   * Finished-game history (SPEC.md Persistence And History): per-player
   * accounting from the archived final snapshot, the suggested settlement,
   * and whether an edited settlement was finalized. Newest first.
   */
  listHistory(): HistoryEntry[] {
    return listFinishedGameRows(this.deps.db).map((row) =>
      toHistoryEntry(row, getCashSettlement(this.deps.db, row.gameId)),
    )
  }

  /** Session-level stats for one profile (SPEC.md Stats). */
  profileStats(profileId: string): ProfileStats {
    return aggregateProfileStats(profileId, listFinishedGameRows(this.deps.db))
  }

  /**
   * The finalized settlement for a game code, or null. Falls back to the
   * archive so history remains resolvable after a restart, when finished
   * games are no longer in the runtime code map.
   */
  findSettlementByCode(code: string): CashSettlementRow | null {
    const gameId =
      this.byCode.get(code) ??
      listFinishedGameRows(this.deps.db).find(
        (row) => row.finalSnapshot.game.code === code,
      )?.gameId
    if (!gameId) return null
    return getCashSettlement(this.deps.db, gameId)
  }

  private loadLatestTransaction(gameId: string): VisibleTransaction | undefined {
    const row = latestTransactionRow(this.deps.db, gameId)
    if (!row) return undefined
    const before = snapshotBeforeSeq(this.deps.db, gameId, row.seq)
    const after = snapshotAtSeq(this.deps.db, gameId, row.seq)
    if (!before || !after) return undefined
    return {
      id: VisibleTransactionId.make(row.transactionId),
      label: row.label,
      events: transactionEvents(this.deps.db, row.transactionId),
      before,
      after,
    }
  }

  join(session: SessionRef): { gameId: string; snapshot: GameSnapshot } | null {
    const gameId = this.byCode.get(session.gameCode)
    const runtime = gameId ? this.games.get(gameId) : undefined
    if (!runtime) return null
    this.sockets.set(session.socketId, {
      gameId: runtime.gameId,
      sessionId: session.sessionId,
    })
    return { gameId: runtime.gameId, snapshot: runtime.snapshot }
  }

  processCommand(
    session: SessionRef,
    request: { id?: unknown; command?: unknown },
  ): CommandOutcome {
    const id = typeof request.id === 'string' ? request.id : ''
    const startedAt = this.deps.clock.now()
    const rawTag = (request.command as { _tag?: unknown } | undefined)?._tag
    const cmdTag = typeof rawTag === 'string' ? rawTag : 'unknown'
    const runtime = this.runtimeFor(session.gameCode)
    if (!runtime) {
      this.log.info('command.rejected', `${cmdTag} rejected`, {
        cmd: cmdTag,
        code: session.gameCode,
        reason: 'unknown game code',
      })
      return { status: 'rejected', id, reason: 'unknown game code' }
    }

    const outcome = Effect.runSyncExit(
      runCommandPipeline({
        snapshot: runtime.snapshot,
        raw: request.command,
        guard: (command) => this.guardCommand(runtime, session, command),
        buildContext: (command) => ({
          actingSeat: this.seatFor(runtime, session),
          handId:
            command._tag === 'start-hand'
              ? this.deps.ids.nextId('hand')
              : undefined,
          playerId:
            command._tag === 'claim-seat'
              ? this.deps.ids.nextId('player')
              : undefined,
          playerName:
            command._tag === 'claim-seat'
              ? (getProfile(this.deps.db, command.profileId)?.name ?? undefined)
              : undefined,
          latestTransaction:
            command._tag === 'undo'
              ? this.loadLatestTransaction(runtime.gameId)
              : undefined,
        }),
      }),
    )

    if (outcome._tag === 'Failure') {
      const failure = outcome.cause
      if (failure._tag === 'Fail') {
        this.log.info('command.rejected', `${cmdTag} rejected`, {
          cmd: cmdTag,
          code: runtime.code,
          gameId: runtime.gameId,
          reason: failure.error.reason,
        })
        return { status: 'rejected', id, reason: failure.error.reason }
      }
      // A defect is a bug, not a rule violation: the full cause must land
      // in the log even though the client only sees a generic reason.
      this.log.error('command.defect', `${cmdTag} hit a pipeline defect`, {
        cmd: cmdTag,
        code: runtime.code,
        gameId: runtime.gameId,
        cause: Cause.pretty(outcome.cause),
      })
      return { status: 'rejected', id, reason: 'internal pipeline error' }
    }

    let { result } = outcome.value
    const { command } = outcome.value
    if (command._tag === 'undo') {
      // A restored snapshot may claim 'connected' for a seat whose socket
      // is long gone (undoing a seat-interrupted system transition). Like
      // restart restore, connection state is normalized against reality —
      // otherwise mark-interrupted-folded and release-seat both dead-end
      // on a phantom "live" connection (verification finding, Slice 10).
      result = {
        ...result,
        snapshot: this.normalizeConnections(runtime, result.snapshot),
      }
    }
    const actorProfileId = this.actorProfile(runtime, session, command)
    const transactionId = this.persistAndBroadcast(runtime, actorProfileId, result)
    this.updateClaims(runtime, session, command, result)
    this.log.info('command.accepted', `${command._tag} accepted`, {
      cmd: command._tag,
      code: runtime.code,
      gameId: runtime.gameId,
      actor: actorProfileId,
      seat: this.seatFor(runtime, session),
      vtx: transactionId,
      events: result.events.length,
      durMs: this.deps.clock.now() - startedAt,
    })
    return { status: 'ack', id }
  }

  handleDisconnect(socketId: string): void {
    const ref = this.sockets.get(socketId)
    this.sockets.delete(socketId)
    if (!ref) return
    const runtime = this.games.get(ref.gameId)
    if (!runtime) return

    for (const claim of runtime.claims.values()) {
      if (claim.socketId !== socketId) continue
      claim.socketId = null
      const result = interruptSeat(runtime.snapshot, claim.seatIndex)
      if (result.ok) {
        // System transition: audited with no acting profile; never a fold.
        this.persistAndBroadcast(runtime, null, result)
      }
    }
  }

  private runtimeFor(gameCode: string): GameRuntime | undefined {
    const gameId = this.byCode.get(gameCode)
    return gameId ? this.games.get(gameId) : undefined
  }

  /** Downgrade snapshot 'connected' seats without a live socket to interrupted. */
  private normalizeConnections(
    runtime: GameRuntime,
    snapshot: GameSnapshot,
  ): GameSnapshot {
    const players = snapshot.players.map((player) => {
      if (player.connection !== 'connected') return player
      const claim = runtime.claims.get(player.seatIndex)
      const live =
        claim !== undefined &&
        claim.socketId !== null &&
        claim.playerId === player.id
      return live ? player : { ...player, connection: 'interrupted' as const }
    })
    return { ...snapshot, players }
  }

  private seatFor(runtime: GameRuntime, session: SessionRef): number | null {
    for (const claim of runtime.claims.values()) {
      if (claim.sessionId === session.sessionId) return claim.seatIndex
    }
    return null
  }

  /** Live-socket seat locks and silent session-hint rules (SPEC.md). */
  private guardCommand(
    runtime: GameRuntime,
    session: SessionRef,
    command: { _tag: string; seatIndex?: number; profileId?: string },
  ): string | null {
    // The settlement is recorded once: a stale phone still on the cash-out
    // screen must not silently overwrite it (verification F2).
    if (
      command._tag === 'finalize-cash-out' &&
      getCashSettlement(this.deps.db, runtime.gameId) !== null
    ) {
      return 'cash-out already finalized'
    }
    if (command._tag !== 'claim-seat' || command.seatIndex === undefined) {
      return null
    }
    if (command.profileId && !getProfile(this.deps.db, command.profileId)) {
      return 'unknown profile'
    }
    const claim = runtime.claims.get(command.seatIndex)
    if (!claim || claim.sessionId === session.sessionId) return null
    if (claim.socketId !== null) {
      return 'seat is actively connected'
    }
    return 'seat is reserved for its player to reconnect'
  }

  private actorProfile(
    runtime: GameRuntime,
    session: SessionRef,
    command: { _tag: string; profileId?: string },
  ): string | null {
    if (command._tag === 'claim-seat' && command.profileId) {
      return command.profileId
    }
    for (const claim of runtime.claims.values()) {
      if (claim.sessionId === session.sessionId) return claim.profileId
    }
    return null
  }

  private updateClaims(
    runtime: GameRuntime,
    session: SessionRef,
    command: { _tag: string; seatIndex?: number },
    result: ReducerOk,
  ): void {
    if (command._tag === 'claim-seat' && command.seatIndex !== undefined) {
      const player = result.snapshot.players.find(
        (p) => p.seatIndex === command.seatIndex,
      )
      if (player) {
        runtime.claims.set(command.seatIndex, {
          seatIndex: command.seatIndex,
          playerId: player.id,
          profileId: player.profileId,
          sessionId: session.sessionId,
          socketId: session.socketId,
        })
      }
    }
    if (command._tag === 'release-seat' && command.seatIndex !== undefined) {
      runtime.claims.delete(command.seatIndex)
    }
    if (command._tag === 'undo') {
      // A restored snapshot may no longer contain a claimed player (e.g.
      // undoing a seat claim): drop stale locks so the seat is claimable.
      for (const [seat, claim] of runtime.claims) {
        const player = result.snapshot.players.find((p) => p.seatIndex === seat)
        if (!player || player.id !== claim.playerId) {
          runtime.claims.delete(seat)
        }
      }
    }
  }

  /** Persist events + snapshot atomically, THEN broadcast (never before). */
  private persistAndBroadcast(
    runtime: GameRuntime,
    actorProfileId: string | null,
    result: ReducerOk,
  ): string {
    const now = this.deps.clock.now()
    const handId =
      result.snapshot.hand?.id ?? runtime.snapshot.hand?.id ?? null
    const transactionId = this.deps.ids.nextId('vtx')

    const envelopes: EventEnvelope[] = result.events.map((event) => ({
      id: EventId.make(this.deps.ids.nextId('evt')),
      gameId: GameId.make(runtime.gameId),
      handId: handId === null ? null : HandId.make(handId),
      visibleTransactionId: VisibleTransactionId.make(transactionId),
      actorProfileId:
        actorProfileId === null ? null : ProfileId.make(actorProfileId),
      timestamp: EpochMillis.make(now),
      event,
    }))

    let snapshot = result.snapshot
    if (envelopes.length > 0) {
      const persist = this.deps.db.transaction(() => {
        const lastSeq = appendEvents(this.deps.db, envelopes)
        snapshot = { ...result.snapshot, eventCursor: lastSeq }
        saveSnapshot(this.deps.db, runtime.gameId, lastSeq, snapshot)
        this.deps.db
          .prepare(
            `INSERT INTO visible_transactions (transaction_id, game_id, seq, label, payload)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            transactionId,
            runtime.gameId,
            lastSeq,
            describeEvents(result.events),
            JSON.stringify({ events: envelopes.map((e) => e.id) }),
          )

        // Lifecycle side tables join the SAME durable transaction so a
        // restart can never resurrect a finished game (PR #171 review):
        // game-finished flips games.status and writes the archive row;
        // cash-out finalization records the settlement.
        if (result.events.some((e) => e._tag === 'game-finished')) {
          const summary = computeCashOut(snapshot)
          archiveFinishedGame(this.deps.db, {
            gameId: runtime.gameId,
            finishedAt: now,
            finalSnapshot: snapshot,
            settlement: {
              totalBuyInCents: summary.totalBuyInCents,
              transfers: summary.suggestedTransfers,
            },
          })
        }
        const finalization = result.events.find(
          (e) => e._tag === 'cash-out-finalized',
        )
        if (finalization) {
          this.deps.db
            .prepare(
              `INSERT OR REPLACE INTO cash_settlements (game_id, finalized_at, payload)
               VALUES (?, ?, ?)`,
            )
            .run(
              runtime.gameId,
              now,
              JSON.stringify({ transfers: finalization.transfers }),
            )
        }
      })
      persist()
    }

    runtime.snapshot = snapshot
    this.deps.broadcaster.emitSnapshot(runtime.gameId, snapshot)
    this.deps.broadcaster.emitEvents(runtime.gameId, envelopes)
    if (result.events.some((e) => PRESENCE_EVENTS.has(e._tag))) {
      this.deps.broadcaster.emitPresence(
        runtime.gameId,
        snapshot.players.map((p) => ({
          seatIndex: p.seatIndex,
          connection: p.connection,
        })),
      )
    }
    return transactionId
  }
}
