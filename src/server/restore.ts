import type { GameSnapshot } from '../shared/schema/snapshot'
import type { AppDatabase } from './persistence/db'
import { listActiveGames } from './persistence/game-store'
import { latestSnapshot } from './persistence/snapshot-store'

export interface RestoredGame {
  gameId: string
  code: string
  snapshot: GameSnapshot
}

/**
 * Rebuild active games on server start (ARCHITECTURE.md State Restoration):
 * latest snapshot per game; seats that were connected come back as
 * interrupted/reserved because no live socket survives a restart.
 */
export function restoreActiveGames(db: AppDatabase): RestoredGame[] {
  const restored: RestoredGame[] = []
  for (const game of listActiveGames(db)) {
    const stored = latestSnapshot(db, game.gameId)
    if (!stored) continue
    const snapshot: GameSnapshot = {
      ...stored.snapshot,
      players: stored.snapshot.players.map((p) =>
        p.connection === 'connected' ? { ...p, connection: 'interrupted' } : p,
      ),
    }
    restored.push({ gameId: game.gameId, code: game.code, snapshot })
  }
  return restored
}
