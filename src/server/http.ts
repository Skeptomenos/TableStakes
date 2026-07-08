import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express, { type Express } from 'express'

import { APP_NAME, CONSOLE_ROUTE, GAME_ROUTE_PREFIX, HEALTH_ROUTE } from '../shared/routes'
import type { GameService } from './game-service'
import { lanAddresses } from './lan'
import { noopLogger, truncateSessionId, type Logger, type LogLevel } from './logger'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

export interface CreateHttpAppOptions {
  /** Directory containing the built client (index.html + assets). */
  clientDir?: string
  /** Lazily resolved: the service is constructed after the HTTP app. */
  getService?: () => GameService
  logger?: Logger
}

const CLIENT_LOG_LEVELS: ReadonlySet<string> = new Set(['error', 'warn', 'info'])
const MAX_CLIENT_LOG_ENTRIES = 50
const MAX_CLIENT_LOG_ENTRY_BYTES = 2048

// LAN detection lives in ./lan (deterministic private-LAN-first ordering,
// PR #200 review); re-exported for existing import sites.
export { lanAddresses }

export function createHttpApp(options: CreateHttpAppOptions = {}): Express {
  // The built server bundle lives at dist/server.mjs next to dist/client/.
  const clientDir = options.clientDir ?? path.resolve(moduleDir, 'client')
  const indexHtml = path.join(clientDir, 'index.html')

  const app = express()
  const logger = options.logger ?? noopLogger
  app.disable('x-powered-by')
  app.use(express.json())

  // API request logging: durations at debug, failures at warn. Static
  // assets stay out of the log.
  app.use('/api', (req, res, next) => {
    const startedAt = Date.now()
    res.on('finish', () => {
      const fields = {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durMs: Date.now() - startedAt,
      }
      if (res.statusCode >= 400) {
        logger.warn('http.error', 'api request failed', fields)
      } else {
        logger.debug('http.request', 'api request', fields)
      }
    })
    next()
  })

  app.get(HEALTH_ROUTE, (_req, res) => {
    res.json({ ok: true, name: APP_NAME })
  })

  // Phones ship their warn/error evidence here so one host-side file holds
  // the whole night (ARCHITECTURE.md Observability And Logging).
  app.post('/api/client-logs', (req, res) => {
    const body = req.body as {
      sessionId?: unknown
      gameCode?: unknown
      entries?: unknown
    }
    const entries = Array.isArray(body?.entries) ? body.entries : null
    if (!entries || entries.length === 0 || entries.length > MAX_CLIENT_LOG_ENTRIES) {
      res.status(400).json({ error: `entries must be 1-${MAX_CLIENT_LOG_ENTRIES}` })
      return
    }
    const sid =
      typeof body.sessionId === 'string' ? truncateSessionId(body.sessionId) : ''
    const gameCode = typeof body.gameCode === 'string' ? body.gameCode : undefined
    const ua = req.headers['user-agent']

    for (const raw of entries) {
      const entry = raw as {
        level?: unknown
        event?: unknown
        msg?: unknown
        context?: unknown
      }
      if (
        typeof entry?.event !== 'string' ||
        typeof entry?.msg !== 'string' ||
        JSON.stringify(raw).length > MAX_CLIENT_LOG_ENTRY_BYTES
      ) {
        res.status(400).json({ error: 'invalid log entry' })
        return
      }
    }
    for (const raw of entries) {
      const entry = raw as {
        level?: string
        event: string
        msg: string
        context?: Record<string, unknown>
      }
      const level: LogLevel = CLIENT_LOG_LEVELS.has(entry.level ?? '')
        ? (entry.level as LogLevel)
        : 'info'
      // Context first, stamped identity fields last: a client can enrich
      // its entries but never masquerade as another source or session.
      logger[level]('client.log', entry.msg, {
        ...entry.context,
        source: 'client',
        origin: entry.event,
        sid,
        gameCode,
        ua,
      })
    }
    res.status(204).end()
  })

  app.get('/api/server-info', (_req, res) => {
    const addresses = lanAddresses()
    res.json({ addresses, localhostOnly: addresses.length === 0 })
  })

  app.get('/api/profiles', (_req, res) => {
    const service = options.getService?.()
    if (!service) {
      res.status(503).json({ error: 'service unavailable' })
      return
    }
    res.json({ profiles: service.listProfiles() })
  })

  app.post('/api/profiles', (req, res) => {
    const service = options.getService?.()
    if (!service) {
      res.status(503).json({ error: 'service unavailable' })
      return
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (name.length === 0 || name.length > 40) {
      res.status(400).json({ error: 'profile name must be 1-40 characters' })
      return
    }
    res.status(201).json(service.createProfile(name))
  })

  // Games are created from the console; no profile is required (ADR 0002,
  // SPEC.md). When a profile is supplied it is recorded for audit only —
  // no privileged role exists — and an unknown one is still rejected.
  app.post('/api/games', (req, res) => {
    const service = options.getService?.()
    if (!service) {
      res.status(503).json({ error: 'service unavailable' })
      return
    }
    const creatorProfileId =
      typeof req.body?.creatorProfileId === 'string'
        ? req.body.creatorProfileId
        : undefined
    try {
      const game = service.createGame({ creatorProfileId })
      res.status(201).json(game)
    } catch {
      res.status(400).json({ error: 'unknown creator profile' })
    }
  })

  // Player landing's tap-to-join list (ADR 0002): active tables with
  // seated counts so a second device finds the existing table instead of
  // seeing ten empty seats at a table of its own.
  app.get('/api/games', (_req, res) => {
    const service = options.getService?.()
    if (!service) {
      res.status(503).json({ error: 'service unavailable' })
      return
    }
    res.json({ games: service.listGames() })
  })

  app.get('/api/games/:code', (req, res) => {
    const service = options.getService?.()
    const game = service?.findGameByCode(req.params.code) ?? null
    if (!game) {
      res.status(404).json({ error: 'unknown game code' })
      return
    }
    res.json({ code: game.code, status: game.status })
  })

  // Finished-game history and session stats (SPEC.md Persistence And
  // History / Stats): read-only over the SQLite archive, so both survive
  // restarts even though finished games leave the runtime.
  app.get('/api/history', (_req, res) => {
    const service = options.getService?.()
    if (!service) {
      res.status(503).json({ error: 'service unavailable' })
      return
    }
    res.json({ games: service.listHistory() })
  })

  app.get('/api/profiles/:profileId/stats', (req, res) => {
    const service = options.getService?.()
    if (!service) {
      res.status(503).json({ error: 'service unavailable' })
      return
    }
    res.json(service.profileStats(req.params.profileId))
  })

  app.get('/api/games/:code/settlement', (req, res) => {
    const service = options.getService?.()
    if (!service) {
      res.status(503).json({ error: 'service unavailable' })
      return
    }
    const settlement = service.findSettlementByCode(req.params.code)
    if (!settlement) {
      res.status(404).json({ error: 'no finalized settlement' })
      return
    }
    res.json({
      finalizedAt: settlement.finalizedAt,
      transfers: settlement.transfers,
    })
  })

  // Undo confirmation copy (SPEC.md Undo: "shows what will be reversed").
  // The client previews here, then sends `undo` with the transaction id so
  // a table action landing in between safely rejects the stale undo.
  app.get('/api/games/:code/undo-preview', (req, res) => {
    const service = options.getService?.()
    const game = service?.findGameByCode(req.params.code) ?? null
    if (!game) {
      res.status(404).json({ error: 'unknown game code' })
      return
    }
    const preview = service!.undoPreview(game.gameId)
    if (!preview) {
      res.status(404).json({ error: 'nothing to undo' })
      return
    }
    res.json(preview)
  })

  app.use(express.static(clientDir, { index: 'index.html' }))

  // SPA fallback: the client router owns /, /g/<code>, and /console
  // (ADR 0002: the table console is a third top-level route).
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      next()
      return
    }
    if (
      req.path !== '/' &&
      req.path !== CONSOLE_ROUTE &&
      !req.path.startsWith(GAME_ROUTE_PREFIX)
    ) {
      next()
      return
    }
    if (!existsSync(indexHtml)) {
      res
        .status(503)
        .type('text/plain')
        .send('Client build missing. Run `pnpm build` (or use `pnpm dev`).')
      return
    }
    // Serve relative to root: an absolute path would trip sendFile's dotfile
    // rejection when the checkout lives under a dot-directory (git worktrees).
    res.sendFile('index.html', { root: clientDir })
  })

  return app
}
