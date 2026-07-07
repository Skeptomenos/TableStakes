import { describe, expect, it } from 'vitest'

import { welcomeBanner } from './welcome'

describe('welcomeBanner', () => {
  it('shows the LAN URL, a scannable QR block, and host steps', () => {
    const banner = welcomeBanner({ port: 8080, addresses: ['192.168.1.5'] })
    expect(banner).toContain('http://192.168.1.5:8080')
    // QR block: uqr's compact unicode rendering uses half-block glyphs.
    expect(banner).toMatch(/[█▀▄]/)
    expect(banner).toContain('Keep this window open')
    expect(banner).toContain('scan this with your phone camera')
    expect(banner).toContain('Ctrl+C')
  })

  it('lists extra addresses when several interfaces are reachable', () => {
    const banner = welcomeBanner({
      port: 8080,
      addresses: ['192.168.1.5', '100.80.1.2'],
    })
    expect(banner).toContain('also reachable via 100.80.1.2')
  })

  it('warns instead of rendering a QR when only localhost is reachable', () => {
    const banner = welcomeBanner({ port: 8080, addresses: [] })
    expect(banner).toContain('No Wi-Fi/LAN address found')
    expect(banner).toContain('http://localhost:8080')
    expect(banner).not.toMatch(/[█▀▄]/)
  })
})
