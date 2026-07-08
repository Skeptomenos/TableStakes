// Thin fetch wrappers for the host-owned HTTP API.

export interface ProfileInfo {
  profileId: string
  name: string
}

export interface ServerInfo {
  addresses: string[]
  localhostOnly: boolean
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `request failed (${response.status})`)
  }
  return (await response.json()) as T
}

export async function getProfiles(): Promise<ProfileInfo[]> {
  const data = await json<{ profiles: ProfileInfo[] }>(await fetch('/api/profiles'))
  return data.profiles
}

export async function createProfile(name: string): Promise<ProfileInfo> {
  return json(
    await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  )
}

// Console-created tables need no profile at all (ADR 0002): the audit
// records console origin instead of a creator.
export async function createGame(
  creatorProfileId?: string,
): Promise<{ gameId: string; code: string }> {
  return json(
    await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(creatorProfileId ? { creatorProfileId } : {}),
    }),
  )
}

export interface ActiveGameInfo {
  code: string
  status: string
  seatedCount: number
  createdAt: number
}

/** Active (non-finished) tables for the player landing's tap-to-join list. */
export async function listGames(): Promise<ActiveGameInfo[]> {
  const data = await json<{ games: ActiveGameInfo[] }>(await fetch('/api/games'))
  return data.games
}

export async function getServerInfo(): Promise<ServerInfo> {
  return json(await fetch('/api/server-info'))
}

export interface HistoryGame {
  gameId: string
  code: string
  finishedAt: number
  handsPlayed: number
  finalized: boolean
  settlement: {
    totalBuyInCents: number
    transfers: { fromProfileId: string; toProfileId: string; cents: number }[]
  }
  players: {
    profileId: string
    name: string
    buyInCents: number
    cashOutCents: number
    netCents: number
  }[]
}

export async function getHistory(): Promise<HistoryGame[]> {
  const data = await json<{ games: HistoryGame[] }>(await fetch('/api/history'))
  return data.games
}

export interface ProfileStatsInfo {
  profileId: string
  gamesPlayed: number
  totalBuyInCents: number
  totalCashOutCents: number
  totalNetCents: number
  biggestWinCents: number
  biggestLossCents: number
  averageNetCents: number
  totalHandsPlayed: number
  games: {
    gameId: string
    code: string
    finishedAt: number
    handsPlayed: number
    buyInCents: number
    cashOutCents: number
    netCents: number
  }[]
}

export async function getProfileStats(
  profileId: string,
): Promise<ProfileStatsInfo> {
  return json(await fetch(`/api/profiles/${profileId}/stats`))
}

export interface SettlementInfo {
  finalizedAt: number
  transfers: { fromProfileId: string; toProfileId: string; cents: number }[]
}

/** The finalized settlement for a game, or null while cash-out is open. */
export async function getSettlement(code: string): Promise<SettlementInfo | null> {
  const response = await fetch(`/api/games/${code}/settlement`)
  if (response.status === 404) return null
  return json(response)
}

export interface UndoPreviewInfo {
  transactionId: string
  label: string
  events: string[]
  undoable: boolean
  reason?: string
}

/** What confirming undo would reverse; null when nothing is undoable. */
export async function getUndoPreview(
  code: string,
): Promise<UndoPreviewInfo | null> {
  const response = await fetch(`/api/games/${code}/undo-preview`)
  if (response.status === 404) return null
  return json(response)
}
