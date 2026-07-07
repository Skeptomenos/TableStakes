import { Schema } from 'effect'
import type { Server } from 'socket.io'

import { EventEnvelope } from '../shared/schema/events'
import { GameSnapshot } from '../shared/schema/snapshot'
import type { Broadcaster, GameService } from './game-service'
import { noopLogger, truncateSessionId, type Logger } from './logger'

const encodeSnapshot = Schema.encodeSync(GameSnapshot)
const encodeEnvelope = Schema.encodeSync(EventEnvelope)

// One Socket.IO room per game (ARCHITECTURE.md Realtime Transport). Seat
// identity comes from the app-level session/claim model, never socket ids.

function roomFor(gameId: string): string {
  return `game:${gameId}`
}

export function socketBroadcaster(io: Server): Broadcaster {
  return {
    emitSnapshot: (gameId, snapshot) => {
      io.to(roomFor(gameId)).emit('snapshot', { snapshot: encodeSnapshot(snapshot) })
    },
    emitEvents: (gameId, envelopes) => {
      if (envelopes.length === 0) return
      io.to(roomFor(gameId)).emit('event-feed-entry', {
        envelopes: envelopes.map((envelope) => encodeEnvelope(envelope)),
      })
    },
    emitPresence: (gameId, presence) => {
      io.to(roomFor(gameId)).emit('presence-updated', { presence })
    },
  }
}

export function wireSockets(
  io: Server,
  service: GameService,
  logger: Logger = noopLogger,
): void {
  // Engine-level connection failures (bad handshakes, transport errors)
  // are the earliest signal for phone connectivity problems.
  io.engine.on('connection_error', (error: { code?: number; message?: string }) => {
    logger.warn('socket.engine_error', 'engine connection error', {
      code: error.code,
      message: error.message,
    })
  })

  io.on('connection', (socket) => {
    const auth = socket.handshake.auth as {
      gameCode?: unknown
      sessionId?: unknown
    }
    const gameCode = typeof auth.gameCode === 'string' ? auth.gameCode : ''
    const sessionId = typeof auth.sessionId === 'string' ? auth.sessionId : ''

    // Validate the session BEFORE service.join so rejected connections are
    // never registered in the service's socket registry (verification
    // finding: a dead entry would leak, since the disconnect handler is
    // not yet attached at this point).
    if (sessionId === '') {
      logger.warn('socket.join_error', 'missing session id', { gameCode })
      socket.emit('join-error', { reason: 'missing session id' })
      socket.disconnect(true)
      return
    }

    const joined = service.join({ gameCode, sessionId, socketId: socket.id })
    if (!joined) {
      logger.warn('socket.join_error', 'unknown game code', {
        gameCode,
        reason: 'unknown game code',
      })
      socket.emit('join-error', { reason: 'unknown game code' })
      socket.disconnect(true)
      return
    }

    logger.info('socket.connect', 'client joined game room', {
      sid: truncateSessionId(sessionId),
      gameCode,
      transport: socket.conn.transport.name,
      remote: socket.handshake.address,
    })

    void socket.join(roomFor(joined.gameId))
    // Full snapshot on join: reconnecting clients may have missed events.
    socket.emit('snapshot', { snapshot: encodeSnapshot(joined.snapshot) })

    socket.on('command', (request: unknown) => {
      const safeRequest =
        typeof request === 'object' && request !== null
          ? (request as { id?: unknown; command?: unknown })
          : {}
      const outcome = service.processCommand(
        { gameCode, sessionId, socketId: socket.id },
        safeRequest,
      )
      if (outcome.status === 'ack') {
        socket.emit('command-ack', { id: outcome.id })
      } else {
        socket.emit('command-rejected', {
          id: outcome.id,
          reason: outcome.reason,
        })
      }
    })

    socket.on('disconnect', (reason) => {
      // The reason distinguishes phone sleep (`ping timeout`), Wi-Fi loss
      // (`transport close`), and deliberate leave (`client namespace
      // disconnect`) — the core connection-issue diagnostic.
      logger.info('socket.disconnect', 'client disconnected', {
        sid: truncateSessionId(sessionId),
        gameCode,
        reason,
      })
      service.handleDisconnect(socket.id)
    })
  })
}
