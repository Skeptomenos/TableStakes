import { mkdirSync } from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

export type AppDatabase = Database.Database

/**
 * One local SQLite database file (SPEC.md Persistence). WAL keeps the
 * single-process server responsive; foreign keys stay enforced.
 */
export function openDatabase(filePath: string): AppDatabase {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

/** Default runtime database location under the app data directory. */
export function defaultDatabasePath(appDir: string): string {
  return path.join(appDir, 'data', 'poker-chip-counter.db')
}
