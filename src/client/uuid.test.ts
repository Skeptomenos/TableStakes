// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { uuid } from './uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uuid', () => {
  it('returns a v4 UUID when crypto.randomUUID exists', () => {
    expect(uuid()).toMatch(V4)
  })

  it('works WITHOUT crypto.randomUUID (plain-HTTP LAN origins)', () => {
    // Regression (David's phone playthrough, 2026-07-08): crypto.randomUUID
    // is secure-context-only, so it does not exist on http://<lan-ip> —
    // exactly how every phone joins. The first sessionId() call threw and
    // crashed the whole game route; the crash report died the same way.
    vi.stubGlobal('crypto', {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    })
    expect('randomUUID' in globalThis.crypto).toBe(false)
    expect(uuid()).toMatch(V4)
    expect(uuid()).not.toBe(uuid())
  })
})
