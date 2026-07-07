import { describe, expect, it } from 'vitest'

import {
  GAME_CODE_LENGTH,
  GAME_ROUTE_PREFIX,
  HEALTH_ROUTE,
  gameRoute,
} from './routes'

describe('shared route literals', () => {
  it('matches the SPEC.md game URL shape /g/<five-digit-code>', () => {
    expect(GAME_ROUTE_PREFIX).toBe('/g/')
    expect(GAME_CODE_LENGTH).toBe(5)
    expect(gameRoute('48317')).toBe('/g/48317')
  })

  it('exposes the health endpoint used by smoke checks', () => {
    expect(HEALTH_ROUTE).toBe('/healthz')
  })
})
