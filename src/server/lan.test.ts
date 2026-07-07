import { describe, expect, it } from 'vitest'

import { orderLanAddresses } from './lan'

// PR #200 review finding 2: networkInterfaces() ordering is not
// guaranteed, so "first address" could be a VPN/Docker/CGNAT address
// phones cannot reach. The QR target must prefer real private-LAN
// ranges deterministically.

type Iface = {
  address: string
  family: string
  internal: boolean
}

function iface(address: string, overrides: Partial<Iface> = {}): Iface {
  return { address, family: 'IPv4', internal: false, ...overrides }
}

describe('orderLanAddresses', () => {
  it('prefers home-router ranges over CGNAT/VPN addresses regardless of OS order', () => {
    // Tailscale (100.64/10 CGNAT) listed FIRST by the OS: the home
    // 192.168.x address must still win the QR slot.
    const ordered = orderLanAddresses({
      tailscale0: [iface('100.87.188.101')],
      en0: [iface('192.168.178.104')],
    })
    expect(ordered).toEqual(['192.168.178.104', '100.87.188.101'])
  })

  it('ranks private ranges ahead of Docker-style bridges and public addresses', () => {
    const ordered = orderLanAddresses({
      docker0: [iface('172.17.0.1')],
      eth0: [iface('10.1.2.3')],
      wan0: [iface('203.0.113.9')],
    })
    // 10/8 is a real private LAN; 172.17.x sits in 172.16/12 (commonly a
    // Docker bridge) below it; public last.
    expect(ordered).toEqual(['10.1.2.3', '172.17.0.1', '203.0.113.9'])
  })

  it('drops internal, non-IPv4, and link-local addresses', () => {
    const ordered = orderLanAddresses({
      lo0: [iface('127.0.0.1', { internal: true })],
      en0: [iface('fe80::1', { family: 'IPv6' }), iface('192.168.1.5')],
      awdl0: [iface('169.254.12.34')],
    })
    expect(ordered).toEqual(['192.168.1.5'])
  })

  it('keeps a stable order within the same preference tier', () => {
    const ordered = orderLanAddresses({
      en1: [iface('192.168.0.7')],
      en0: [iface('192.168.0.5')],
    })
    // Same tier: lexicographic interface-independent tiebreak by address.
    expect(ordered).toEqual(['192.168.0.5', '192.168.0.7'])
  })
})
