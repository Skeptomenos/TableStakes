import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_PORT } from '../shared/routes'
import { createPokerServer } from './app'
import { lanAddresses } from './http'
import {
  consoleSink,
  createLogger,
  fileSink,
  parseLogLevel,
  serializeError,
  sweepLogs,
} from './logger'
import { defaultDatabasePath, openDatabase } from './persistence/db'
import { migrate } from './persistence/migrations'
import {
  randomCodeGenerator,
  randomIdGenerator,
  systemClock,
} from './services'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
// The built bundle lives at dist/server.mjs; the app dir is its parent.
const appDir = path.resolve(moduleDir, '..')

const logDir = process.env.PCC_LOG_DIR ?? path.join(appDir, 'data', 'logs')
sweepLogs(logDir, { clock: systemClock })
const log = createLogger({
  level: parseLogLevel(process.env.PCC_LOG_LEVEL),
  sinks: [consoleSink(), fileSink(logDir, systemClock)],
  clock: systemClock,
})

// Fatal paths must reach the log file before the process dies; the file
// sink's synchronous appends guarantee the line lands.
process.on('uncaughtException', (error) => {
  log.error('server.fatal', 'uncaught exception', { err: serializeError(error) })
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  log.error('server.fatal', 'unhandled rejection', { err: serializeError(reason) })
  process.exit(1)
})

const port = Number(process.env.PORT ?? DEFAULT_PORT)
const dbPath = process.env.PCC_DB_PATH ?? defaultDatabasePath(appDir)
const db = openDatabase(dbPath)
log.info('db.open', 'database opened', { path: dbPath })
const migrated = migrate(db)
if (migrated.from !== migrated.to) {
  log.info('db.migrate', 'database migrated', migrated)
}

const { httpServer, io, service } = createPokerServer({
  db,
  clock: systemClock,
  ids: randomIdGenerator,
  codes: randomCodeGenerator,
  logger: log,
})

// Bind all interfaces so phones on the same LAN can reach the table.
httpServer.listen(port, '0.0.0.0', () => {
  log.info('server.start', `listening on http://localhost:${port}`, {
    port,
    addresses: lanAddresses(),
    dbPath,
    node: process.version,
  })
})

// Cheap trend data for long game nights.
setInterval(() => {
  log.debug('runtime.heartbeat', 'heartbeat', {
    games: service.gameCount(),
    sockets: io.engine.clientsCount,
    rssMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    uptimeS: Math.round(process.uptime()),
  })
}, 60_000).unref()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('server.shutdown', 'shutting down', { signal })
    io.close()
    httpServer.close()
    db.close()
    process.exit(0)
  })
}
