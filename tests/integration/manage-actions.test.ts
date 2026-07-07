import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GameService, type Broadcaster } from '../../src/server/game-service'
import { openDatabase, type AppDatabase } from '../../src/server/persistence/db'
import { listEventsAfter } from '../../src/server/persistence/event-store'
import { migrate } from '../../src/server/persistence/migrations'
import type { Clock, CodeGenerator, IdGenerator } from '../../src/server/services'

// Slice 10: manage-drawer actions through the full service path — undo with
// preview, recovery of interrupted seats, rebuy timing, cancel, and reset.

let dir: string
let db: AppDatabase

const fixedClock: Clock = { now: () => 1_780_000_000_000 }
const sequentialIds = (): IdGenerator => {
  let n = 0
  return { nextId: (prefix) => `${prefix}_${++n}` }
}
const fixedCodes: CodeGenerator = { nextCode: () => '48317' }

const noopBroadcaster: Broadcaster = {
  emitSnapshot: () => {},
  emitEvents: () => {},
  emitPresence: () => {},
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pcc-manage-'))
  db = openDatabase(path.join(dir, 'test.db'))
  migrate(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const sessions = [
  { sessionId: 'sess-a', socketId: 'sock-a' },
  { sessionId: 'sess-b', socketId: 'sock-b' },
  { sessionId: 'sess-c', socketId: 'sock-c' },
] as const

interface Table {
  service: GameService
  gameId: string
  code: string
  run(
    session: (typeof sessions)[number],
    id: string,
    command: unknown,
  ): ReturnType<GameService['processCommand']>
  snapshot(): NonNullable<ReturnType<GameService['getSnapshot']>>
  playerAt(seat: number): { id: string; profileId: string }
}

/** Three seated, bought-in players with dealer at seat 0 and a hand live. */
function startedTable(options: { startHand?: boolean } = {}): Table {
  const service = new GameService({
    db,
    clock: fixedClock,
    ids: sequentialIds(),
    codes: fixedCodes,
    broadcaster: noopBroadcaster,
  })
  const game = service.createGame({ creatorName: 'Host' })
  const run: Table['run'] = (session, id, command) =>
    service.processCommand({ gameCode: game.code, ...session }, { id, command })

  for (const [i, session] of sessions.entries()) {
    service.join({ gameCode: game.code, ...session })
    const profile = service.createProfile(`Player${i}`)
    run(session, `claim-${i}`, {
      _tag: 'claim-seat',
      seatIndex: i,
      profileId: profile.profileId,
    })
  }
  const seated = service.getSnapshot(game.gameId)!
  for (const [i, session] of sessions.entries()) {
    const player = seated.players.find((p) => p.seatIndex === i)!
    run(session, `buyin-${i}`, {
      _tag: 'record-buy-in',
      playerId: player.id,
      money: { currency: 'EUR', cents: 1000 },
      chips: 1000,
    })
  }
  run(sessions[0], 'dealer', { _tag: 'set-dealer', seatIndex: 0 })
  if (options.startHand !== false) {
    run(sessions[0], 'start', { _tag: 'start-hand' })
  }

  return {
    service,
    gameId: game.gameId,
    code: game.code,
    run,
    snapshot: () => service.getSnapshot(game.gameId)!,
    playerAt: (seat: number) => {
      const player = service.getSnapshot(game.gameId)!.players.find(
        (p) => p.seatIndex === seat,
      )!
      return { id: player.id, profileId: player.profileId }
    },
  }
}

describe('undo through the service', () => {
  it('previews the latest transaction and restores the previous visible state', () => {
    const table = startedTable()
    // Seat 0 raises to 300: the transaction undo will reverse.
    const beforeRaise = table.snapshot()
    table.run(sessions[0], 'raise', { _tag: 'raise', amount: 300 })
    expect(table.snapshot().hand!.currentBet).toBe(300)

    const preview = table.service.undoPreview(table.gameId)!
    expect(preview).not.toBeNull()
    expect(preview.events).toContain('raised')

    const outcome = table.run(sessions[1], 'undo', {
      _tag: 'undo',
      expectedTransactionId: preview.transactionId,
    })
    expect(outcome.status).toBe('ack')

    const restored = table.snapshot()
    expect(restored.hand!.currentBet).toBe(beforeRaise.hand!.currentBet)
    expect(restored.hand!.activeSeat).toBe(beforeRaise.hand!.activeSeat)
    expect(restored.players.map((p) => p.stack)).toEqual(
      beforeRaise.players.map((p) => p.stack),
    )

    // The undo itself is audited with the acting profile.
    const all = listEventsAfter(db, table.gameId, 0)
    const undoEvent = all.find((e) => e.envelope.event._tag === 'undo-committed')!
    expect(undoEvent.envelope.actorProfileId).toBe(table.playerAt(1).profileId)
  })

  it('rejects undo when the previewed transaction is no longer the latest', () => {
    const table = startedTable()
    table.run(sessions[0], 'raise', { _tag: 'raise', amount: 300 })
    const preview = table.service.undoPreview(table.gameId)!
    // A second action lands before the undo is confirmed.
    table.run(sessions[1], 'call', { _tag: 'call' })

    const outcome = table.run(sessions[2], 'undo', {
      _tag: 'undo',
      expectedTransactionId: preview.transactionId,
    })
    expect(outcome.status).toBe('rejected')
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toContain('changed')
    }
  })

  it('undoing a seat claim releases the runtime seat lock', () => {
    const table = startedTable({ startHand: false })
    // A fourth session claims seat 3, then the table undoes the claim.
    const extra = { sessionId: 'sess-d', socketId: 'sock-d' }
    table.service.join({ gameCode: table.code, ...extra })
    const profile = table.service.createProfile('Late')
    table.run(extra as (typeof sessions)[number], 'claim-late', {
      _tag: 'claim-seat',
      seatIndex: 3,
      profileId: profile.profileId,
    })
    expect(table.snapshot().players).toHaveLength(4)

    const preview = table.service.undoPreview(table.gameId)!
    const outcome = table.run(sessions[0], 'undo', {
      _tag: 'undo',
      expectedTransactionId: preview.transactionId,
    })
    expect(outcome.status).toBe('ack')
    expect(table.snapshot().players).toHaveLength(3)

    // Without claims reconciliation the stale lock would reject this claim
    // with 'seat is actively connected'.
    const fresh = { sessionId: 'sess-e', socketId: 'sock-e' }
    table.service.join({ gameCode: table.code, ...fresh })
    const profile2 = table.service.createProfile('Fresh')
    const reclaim = table.service.processCommand(
      { gameCode: table.code, ...fresh },
      {
        id: 'claim-again',
        command: { _tag: 'claim-seat', seatIndex: 3, profileId: profile2.profileId },
      },
    )
    expect(reclaim.status).toBe('ack')
  })

  it('undoing a seat interruption cannot resurrect a dead connection (verification finding)', () => {
    // A disconnect persists seat-interrupted as a normal visible
    // transaction, so the drawer can offer to undo it. The restored
    // snapshot says 'connected', but no live socket exists — without
    // normalization both recovery tools would dead-end ("player is
    // connected" / "seat has a live connection").
    const table = startedTable()
    table.service.handleDisconnect('sock-a')
    expect(
      table.snapshot().players.find((p) => p.seatIndex === 0)!.connection,
    ).toBe('interrupted')

    const preview = table.service.undoPreview(table.gameId)!
    expect(preview.events).toContain('seat-interrupted')
    const outcome = table.run(sessions[1], 'undo-interrupt', {
      _tag: 'undo',
      expectedTransactionId: preview.transactionId,
    })
    expect(outcome.status).toBe('ack')

    const player = table.snapshot().players.find((p) => p.seatIndex === 0)!
    expect(player.connection).toBe('interrupted')

    // The recovery path must still work: seat 0 is due to act.
    const mark = table.run(sessions[1], 'mark-after-undo', {
      _tag: 'mark-interrupted-folded',
      seatIndex: 0,
    })
    expect(mark.status).toBe('ack')
  })

  it('refuses to undo a seat release (PR #182 review)', () => {
    // The runtime claim/session/socket mapping deleted by release-seat is
    // not part of the snapshot and cannot be reconstructed by a restore —
    // the seat is simply reclaimable instead.
    const table = startedTable()
    table.service.handleDisconnect('sock-a')
    const release = table.run(sessions[1], 'release', {
      _tag: 'release-seat',
      seatIndex: 0,
    })
    expect(release.status).toBe('ack')

    // The preview must already say the transaction is not undoable so the
    // drawer never advertises reversibility it cannot deliver (PR #182
    // re-review): the confirm-then-reject path is only the backstop.
    const preview = table.service.undoPreview(table.gameId)!
    expect(preview.events).toContain('seat-released')
    expect(preview.undoable).toBe(false)
    expect(preview.reason).toContain('reclaim')

    const outcome = table.run(sessions[1], 'undo-release', {
      _tag: 'undo',
      expectedTransactionId: preview.transactionId,
    })
    expect(outcome.status).toBe('rejected')
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toContain('reclaim')
    }
    expect(
      table.snapshot().players.find((p) => p.seatIndex === 0)!.connection,
    ).toBe('released')
  })

  it('an undo triggers a presence broadcast (ARCHITECTURE.md undo semantics)', () => {
    let presenceCount = 0
    const service = new GameService({
      db,
      clock: fixedClock,
      ids: sequentialIds(),
      codes: fixedCodes,
      broadcaster: {
        emitSnapshot: () => {},
        emitEvents: () => {},
        emitPresence: () => {
          presenceCount += 1
        },
      },
    })
    const game = service.createGame({ creatorName: 'Host' })
    service.join({ gameCode: game.code, ...sessions[0] })
    const profile = service.createProfile('Alex')
    service.processCommand(
      { gameCode: game.code, ...sessions[0] },
      {
        id: 'c1',
        command: { _tag: 'claim-seat', seatIndex: 0, profileId: profile.profileId },
      },
    )
    const before = presenceCount
    const preview = service.undoPreview(game.gameId)!
    const outcome = service.processCommand(
      { gameCode: game.code, ...sessions[0] },
      {
        id: 'u1',
        command: { _tag: 'undo', expectedTransactionId: preview.transactionId },
      },
    )
    expect(outcome.status).toBe('ack')
    expect(presenceCount).toBe(before + 1)
  })

  it('returns null preview for a fresh game with only game-created', () => {
    const service = new GameService({
      db,
      clock: fixedClock,
      ids: sequentialIds(),
      codes: fixedCodes,
      broadcaster: noopBroadcaster,
    })
    const game = service.createGame({ creatorName: 'Host' })
    // game-created has no before-state to restore.
    expect(service.undoPreview(game.gameId)).toBeNull()
  })
})

describe('interrupted-seat recovery', () => {
  it('a socket disconnect never folds the player by itself', () => {
    const table = startedTable()
    expect(table.snapshot().hand!.activeSeat).toBe(0)

    table.service.handleDisconnect('sock-a')
    const after = table.snapshot()
    const player = after.players.find((p) => p.seatIndex === 0)!
    expect(player.connection).toBe('interrupted')
    expect(player.handStatus).toBe('waiting')
    expect(after.hand!.activeSeat).toBe(0)
  })

  it('another player can mark the blocking interrupted player folded', () => {
    const table = startedTable()
    table.service.handleDisconnect('sock-a')

    const outcome = table.run(sessions[1], 'mark', {
      _tag: 'mark-interrupted-folded',
      seatIndex: 0,
    })
    expect(outcome.status).toBe('ack')
    const after = table.snapshot()
    expect(after.players.find((p) => p.seatIndex === 0)!.handStatus).toBe('folded')
    expect(after.hand!.activeSeat).toBe(1)

    // Audited with the profile of the player who marked it.
    const events = listEventsAfter(db, table.gameId, 0)
    const folded = events.filter((e) => e.envelope.event._tag === 'folded').at(-1)!
    expect(folded.envelope.actorProfileId).toBe(table.playerAt(1).profileId)
  })

  it('rejects marking a connected player folded', () => {
    const table = startedTable()
    const outcome = table.run(sessions[1], 'mark', {
      _tag: 'mark-interrupted-folded',
      seatIndex: 0,
    })
    expect(outcome.status).toBe('rejected')
  })
})

describe('rebuy timing', () => {
  it('rejects a mid-hand rebuy for a player still contesting the hand', () => {
    const table = startedTable()
    const outcome = table.run(sessions[0], 'rebuy', {
      _tag: 'record-rebuy',
      playerId: table.playerAt(0).id,
      money: { currency: 'EUR', cents: 500 },
      chips: 500,
    })
    expect(outcome.status).toBe('rejected')
  })

  it('defers a folded player’s rebuy to the next hand', () => {
    const table = startedTable()
    table.run(sessions[0], 'fold', { _tag: 'fold' })
    const outcome = table.run(sessions[0], 'rebuy', {
      _tag: 'record-rebuy',
      playerId: table.playerAt(0).id,
      money: { currency: 'EUR', cents: 500 },
      chips: 500,
    })
    expect(outcome.status).toBe('ack')

    const during = table.snapshot().players.find((p) => p.seatIndex === 0)!
    expect(during.pendingRebuyChips).toBe(500)
    expect(during.stack).toBe(1000)

    // Fold to end the hand: chips land when the hand closes.
    table.run(sessions[1], 'fold-b', { _tag: 'fold' })
    const closed = table.snapshot()
    expect(closed.game.status).toBe('between-hands')
    const player = closed.players.find((p) => p.seatIndex === 0)!
    expect(player.stack).toBe(1500)
    expect(player.pendingRebuyChips).toBe(0)
  })
})

describe('cancel and reset through the pipeline', () => {
  it('cancel-hand refunds blinds and keeps the button in place', () => {
    const table = startedTable()
    table.run(sessions[0], 'raise', { _tag: 'raise', amount: 300 })

    const outcome = table.run(sessions[2], 'cancel', { _tag: 'cancel-hand' })
    expect(outcome.status).toBe('ack')
    const after = table.snapshot()
    expect(after.game.status).toBe('between-hands')
    expect(after.game.dealerSeat).toBe(0)
    for (const player of after.players) {
      expect(player.stack).toBe(1000)
    }

    // The next hand re-posts from the same positions.
    table.run(sessions[0], 'restart', { _tag: 'start-hand' })
    const next = table.snapshot()
    expect(next.hand!.dealerSeat).toBe(0)
    expect(next.hand!.smallBlindSeat).toBe(1)
    expect(next.hand!.bigBlindSeat).toBe(2)
  })

  it('reset-game returns to setup with purchased stacks', () => {
    const table = startedTable()
    table.run(sessions[0], 'raise', { _tag: 'raise', amount: 300 })

    const outcome = table.run(sessions[1], 'reset', { _tag: 'reset-game' })
    expect(outcome.status).toBe('ack')
    const after = table.snapshot()
    expect(after.game.status).toBe('setup')
    expect(after.hand).toBeNull()
    for (const player of after.players) {
      expect(player.stack).toBe(1000)
      expect(player.totalBuyInCents).toBe(1000)
    }
  })
})

describe('sit-out over the wire', () => {
  it('requires a claimed seat and flips the flag for the acting seat', () => {
    const table = startedTable({ startHand: false })
    const unseated = { sessionId: 'sess-x', socketId: 'sock-x' }
    table.service.join({ gameCode: table.code, ...unseated })
    const rejected = table.service.processCommand(
      { gameCode: table.code, ...unseated },
      { id: 'sitout-x', command: { _tag: 'sit-out' } },
    )
    expect(rejected.status).toBe('rejected')

    const outcome = table.run(sessions[2], 'sitout', { _tag: 'sit-out' })
    expect(outcome.status).toBe('ack')
    expect(
      table.snapshot().players.find((p) => p.seatIndex === 2)!.sitOutNextHand,
    ).toBe(true)
  })
})

describe('mid-hand join', () => {
  it('a new player can claim a free seat without touching the live hand', () => {
    const table = startedTable()
    const before = table.snapshot()

    const late = { sessionId: 'sess-late', socketId: 'sock-late' }
    table.service.join({ gameCode: table.code, ...late })
    const profile = table.service.createProfile('Late')
    const outcome = table.service.processCommand(
      { gameCode: table.code, ...late },
      {
        id: 'claim-late',
        command: { _tag: 'claim-seat', seatIndex: 4, profileId: profile.profileId },
      },
    )
    expect(outcome.status).toBe('ack')

    const after = table.snapshot()
    expect(after.hand).toEqual(before.hand)
    const joined = after.players.find((p) => p.seatIndex === 4)!
    expect(joined.handStatus).toBe('needs-rebuy')
    expect(joined.stack).toBe(0)
  })
})
