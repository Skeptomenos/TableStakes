import type { AppDatabase } from './db'

// Host-owned reusable local profiles (SPEC.md Player Identity): the laptop
// is canonical; phones only hold non-authoritative hints.

export interface ProfileRow {
  profileId: string
  name: string
  createdAt: number
}

export function createProfile(
  db: AppDatabase,
  profile: { profileId: string; name: string; now?: number },
): ProfileRow {
  db.prepare(
    'INSERT INTO player_profiles (profile_id, name, created_at) VALUES (?, ?, ?)',
  ).run(profile.profileId, profile.name, profile.now ?? 0)
  return {
    profileId: profile.profileId,
    name: profile.name,
    createdAt: profile.now ?? 0,
  }
}

export function getProfile(
  db: AppDatabase,
  profileId: string,
): ProfileRow | null {
  const row = db
    .prepare('SELECT * FROM player_profiles WHERE profile_id = ?')
    .get(profileId) as Record<string, unknown> | undefined
  return row
    ? {
        profileId: row.profile_id as string,
        name: row.name as string,
        createdAt: row.created_at as number,
      }
    : null
}

export function listProfiles(db: AppDatabase): ProfileRow[] {
  const rows = db
    .prepare('SELECT * FROM player_profiles ORDER BY created_at, profile_id')
    .all() as Record<string, unknown>[]
  return rows.map((row) => ({
    profileId: row.profile_id as string,
    name: row.name as string,
    createdAt: row.created_at as number,
  }))
}

export function renameProfile(
  db: AppDatabase,
  profileId: string,
  name: string,
): void {
  db.prepare('UPDATE player_profiles SET name = ? WHERE profile_id = ?').run(
    name,
    profileId,
  )
}
