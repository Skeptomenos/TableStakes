// Route literals shared by server, client, and the docs drift check.
// SPEC.md defines the game URL shape: http://<host>:<port>/g/<five-digit-code>

export const HEALTH_ROUTE = '/healthz'
export const GAME_ROUTE_PREFIX = '/g/'
export const GAME_CODE_LENGTH = 5

export const APP_NAME = 'Poker Chip Counter'
export const DEFAULT_PORT = 8080

export function gameRoute(code: string): string {
  return `${GAME_ROUTE_PREFIX}${code}`
}
