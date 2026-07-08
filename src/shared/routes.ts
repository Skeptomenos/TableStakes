// Route literals shared by server, client, and the docs drift check.
// SPEC.md defines the game URL shape: http://<host>:<port>/g/<five-digit-code>

export const HEALTH_ROUTE = '/healthz'
export const GAME_ROUTE_PREFIX = '/g/'
export const GAME_CODE_LENGTH = 5
// The table console (ADR 0002): table lifecycle lives here, never on a
// player surface.
export const CONSOLE_ROUTE = '/console'

export const APP_NAME = 'Poker Chip Counter'
export const DEFAULT_PORT = 8080

export function gameRoute(code: string): string {
  return `${GAME_ROUTE_PREFIX}${code}`
}
