import { createServer, type Server as HttpServer } from 'node:http'

import { Server } from 'socket.io'

import { GameService } from './game-service'
import { createHttpApp } from './http'
import { noopLogger, type Logger } from './logger'
import type { AppDatabase } from './persistence/db'
import type { Clock, CodeGenerator, IdGenerator } from './services'
import { socketBroadcaster, wireSockets } from './socket'

export interface PokerServerDeps {
  db: AppDatabase
  clock: Clock
  ids: IdGenerator
  codes: CodeGenerator
  clientDir?: string
  logger?: Logger
}

export interface PokerServer {
  httpServer: HttpServer
  io: Server
  service: GameService
}

/** Compose HTTP (static client + API), Socket.IO, and the game service. */
export function createPokerServer(deps: PokerServerDeps): PokerServer {
  const logger = deps.logger ?? noopLogger
  // The HTTP app is built before the service exists (service needs io,
  // io needs the http server), so API handlers resolve it lazily.
  const serviceRef: { current?: GameService } = {}
  const app = createHttpApp({
    clientDir: deps.clientDir,
    getService: () => serviceRef.current!,
    logger,
  })
  const httpServer = createServer(app)
  const io = new Server(httpServer)
  const service = new GameService({
    db: deps.db,
    clock: deps.clock,
    ids: deps.ids,
    codes: deps.codes,
    broadcaster: socketBroadcaster(io),
    logger,
  })
  serviceRef.current = service
  wireSockets(io, service, logger)
  return { httpServer, io, service }
}
