import { io, type Socket } from 'socket.io-client'

import type { GameSnapshot } from '../shared/schema/snapshot'
import { logClient, setClientLogContext } from './logging'
import { uuid } from './uuid'

// The server snapshot is canonical; the client renders it and submits
// commands. A command counts as committed only after the server ack
// (ARCHITECTURE.md Client Architecture).

export interface GameConnection {
  socket: Socket
  onSnapshot(listener: (snapshot: GameSnapshot) => void): void
  onJoinError(listener: (reason: string) => void): void
  sendCommand(command: unknown): Promise<void>
  disconnect(): void
}

export function connectToGame(
  gameCode: string,
  session: string,
  baseUrl?: string,
): GameConnection {
  const options = {
    auth: { gameCode, sessionId: session },
    transports: ['websocket'] as ['websocket'],
    // Auto-reconnect is load-bearing (host laptop sleep/wake), but cap the
    // retry pace: stored logs showed 1000+ fast retries across a 75-minute
    // host outage from a single idle tab.
    reconnectionDelayMax: 10_000,
  }
  const socket = baseUrl ? io(baseUrl, options) : io(options)

  // A join-error is terminal for this connection: stop the reconnection
  // manager explicitly instead of relying on the server's disconnect.
  socket.on('join-error', () => {
    logClient('warn', 'socket.join_error_stop', 'join rejected; stopping reconnection')
    socket.disconnect()
  })

  // Ship connection lifecycle to the host: this is the phone-side half of
  // the connection-issue diagnostics.
  setClientLogContext(gameCode)
  socket.on('connect_error', (error) => {
    logClient('warn', 'socket.connect_error', error.message)
  })
  socket.on('disconnect', (reason) => {
    logClient('warn', 'socket.disconnect', reason)
  })
  socket.io.on('reconnect_attempt', (attempt) => {
    logClient('warn', 'socket.reconnect_attempt', `attempt ${attempt}`)
  })
  socket.io.on('reconnect', (attempt) => {
    logClient('warn', 'socket.reconnect', `reconnected after ${attempt} attempts`)
  })

  return {
    socket,
    onSnapshot(listener) {
      socket.on('snapshot', ({ snapshot }: { snapshot: GameSnapshot }) => {
        listener(snapshot)
      })
    },
    onJoinError(listener) {
      socket.on('join-error', ({ reason }: { reason: string }) => {
        listener(reason)
      })
    },
    sendCommand(command: unknown): Promise<void> {
      const id = uuid()
      return new Promise((resolve, reject) => {
        const onAck = (payload: { id: string }) => {
          if (payload.id !== id) return
          cleanup()
          resolve()
        }
        const onReject = (payload: { id: string; reason: string }) => {
          if (payload.id !== id) return
          cleanup()
          reject(new Error(payload.reason))
        }
        const cleanup = () => {
          socket.off('command-ack', onAck)
          socket.off('command-rejected', onReject)
        }
        socket.on('command-ack', onAck)
        socket.on('command-rejected', onReject)
        socket.emit('command', { id, command })
      })
    },
    disconnect() {
      socket.disconnect()
    },
  }
}
