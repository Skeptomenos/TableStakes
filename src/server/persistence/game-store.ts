import type { AppDatabase } from './db'

export interface GameRow {
  gameId: string
  code: string
  status: string
  creatorProfileId: string
  createdAt: number
  updatedAt: number
}

export interface CreateGameOptions {
  gameId: string
  creatorProfileId: string
  /** Five-digit code generator; deterministic in tests. */
  generateCode: () => string
  maxAttempts?: number
  now?: number
}

/**
 * Create a game with a unique five-digit code: generate, reserve in
 * game_codes (SQLite uniqueness is the collision guard), regenerate on
 * collision, and fail loudly when attempts are exhausted (SPEC.md).
 */
export function createGameWithUniqueCode(
  db: AppDatabase,
  options: CreateGameOptions,
): GameRow {
  const maxAttempts = options.maxAttempts ?? 20
  const now = options.now ?? 0
  const reserve = db.transaction((code: string) => {
    db.prepare('INSERT INTO game_codes (code, game_id) VALUES (?, ?)').run(
      code,
      options.gameId,
    )
    db.prepare(
      `INSERT INTO games (game_id, code, status, creator_profile_id, created_at, updated_at)
       VALUES (?, ?, 'setup', ?, ?, ?)`,
    ).run(options.gameId, code, options.creatorProfileId, now, now)
  })

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = options.generateCode()
    try {
      reserve(code)
      return {
        gameId: options.gameId,
        code,
        status: 'setup',
        creatorProfileId: options.creatorProfileId,
        createdAt: now,
        updatedAt: now,
      }
    } catch (error) {
      // Only a game_codes uniqueness violation is a collision. Match the
      // SQLite error code first (better-sqlite3 sets SQLITE_CONSTRAINT_*),
      // then the constraint name — message-only matching could swallow
      // unrelated constraint failures (Slice 12 hardening).
      const sqliteCode = (error as { code?: unknown }).code
      if (
        error instanceof Error &&
        typeof sqliteCode === 'string' &&
        sqliteCode.startsWith('SQLITE_CONSTRAINT') &&
        error.message.includes('game_codes.code')
      ) {
        continue
      }
      throw error
    }
  }
  throw new Error(
    `could not allocate a unique game code after ${maxAttempts} collision attempts`,
  )
}

function toRow(row: Record<string, unknown>): GameRow {
  return {
    gameId: row.game_id as string,
    code: row.code as string,
    status: row.status as string,
    creatorProfileId: row.creator_profile_id as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function getGameByCode(db: AppDatabase, code: string): GameRow | null {
  const row = db.prepare('SELECT * FROM games WHERE code = ?').get(code)
  return row ? toRow(row as Record<string, unknown>) : null
}

export function getGame(db: AppDatabase, gameId: string): GameRow | null {
  const row = db.prepare('SELECT * FROM games WHERE game_id = ?').get(gameId)
  return row ? toRow(row as Record<string, unknown>) : null
}

export function listActiveGames(db: AppDatabase): GameRow[] {
  const rows = db
    .prepare("SELECT * FROM games WHERE status != 'finished' ORDER BY created_at")
    .all() as Record<string, unknown>[]
  return rows.map(toRow)
}

export function updateGameStatus(
  db: AppDatabase,
  gameId: string,
  status: string,
  now = 0,
): void {
  db.prepare('UPDATE games SET status = ?, updated_at = ? WHERE game_id = ?').run(
    status,
    now,
    gameId,
  )
}
