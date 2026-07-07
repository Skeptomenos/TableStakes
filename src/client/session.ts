// Silent browser-local hints (SPEC.md Player Identity): they preselect
// host-owned state and smooth reconnect, but are never authoritative and
// never user-facing. No PIN, password, or token surfaces exist.

import { uuid } from './uuid'

const SESSION_KEY = 'pcc-session-id'

export function sessionId(): string {
  let value = localStorage.getItem(SESSION_KEY)
  if (!value) {
    value = uuid()
    localStorage.setItem(SESSION_KEY, value)
  }
  return value
}

export function rememberProfile(gameCode: string, profileId: string): void {
  localStorage.setItem(`pcc-profile-${gameCode}`, profileId)
}

export function recallProfile(gameCode: string): string | null {
  return localStorage.getItem(`pcc-profile-${gameCode}`)
}
