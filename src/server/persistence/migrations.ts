import type { AppDatabase } from './db'

// Versioned migrations via PRAGMA user_version. Append new migrations to
// the list; never edit an applied one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE games (
    game_id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'setup',
    creator_profile_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE game_codes (
    code TEXT PRIMARY KEY,
    game_id TEXT NOT NULL
  );
  CREATE TABLE player_profiles (
    profile_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE game_players (
    game_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    seat_index INTEGER NOT NULL,
    PRIMARY KEY (game_id, player_id)
  );
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    game_id TEXT NOT NULL,
    hand_id TEXT,
    visible_transaction_id TEXT NOT NULL,
    actor_profile_id TEXT,
    timestamp INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX idx_events_game ON events (game_id, seq);
  CREATE TABLE snapshots (
    game_id TEXT NOT NULL,
    event_seq INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (game_id, event_seq)
  );
  CREATE TABLE visible_transactions (
    transaction_id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    label TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX idx_vtx_game ON visible_transactions (game_id, seq);
  CREATE TABLE finished_games (
    game_id TEXT PRIMARY KEY,
    finished_at INTEGER NOT NULL,
    final_snapshot TEXT NOT NULL,
    settlement TEXT NOT NULL
  );
  CREATE TABLE cash_settlements (
    game_id TEXT PRIMARY KEY,
    finalized_at INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
  `,
  // ADR 0002: creating a game no longer requires a profile — console
  // origin is recorded instead of a creator. SQLite has no ALTER COLUMN,
  // so the games table is rebuilt with a nullable creator_profile_id.
  `
  ALTER TABLE games RENAME TO games_v0;
  CREATE TABLE games (
    game_id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'setup',
    creator_profile_id TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO games (game_id, code, status, creator_profile_id, created_at, updated_at)
    SELECT game_id, code, status, creator_profile_id, created_at, updated_at FROM games_v0;
  DROP TABLE games_v0;
  `,
]

export function migrate(db: AppDatabase): { from: number; to: number } {
  const applied = db.pragma('user_version', { simple: true }) as number
  // Downgrade guard (post-verification F4): a database stamped by a newer
  // build has schema this build knows nothing about — fail loudly instead
  // of silently returning from > to.
  if (applied > MIGRATIONS.length) {
    throw new Error(
      `database schema v${applied} is newer than this build (v${MIGRATIONS.length}) — refusing to run; upgrade the app or restore the older database`,
    )
  }
  const run = db.transaction(() => {
    for (let version = applied; version < MIGRATIONS.length; version++) {
      db.exec(MIGRATIONS[version]!)
      db.pragma(`user_version = ${version + 1}`)
    }
  })
  run()
  return { from: applied, to: MIGRATIONS.length }
}
