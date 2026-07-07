import { networkInterfaces } from 'node:os'

// Deterministic LAN address selection (PR #200 review): the OS returns
// interfaces in arbitrary order, so "first non-internal IPv4" could be a
// VPN, CGNAT (Tailscale 100.64/10), or Docker-bridge address that phones
// on the home Wi-Fi cannot reach. Rank candidates by how likely a phone
// on the same Wi-Fi can reach them; the winner fronts the QR code and
// the share card, the rest stay listed as fallbacks.

interface AddressLike {
  address: string
  family: string
  internal: boolean
}

/** Lower tier = more likely reachable by a phone on the home network. */
function tier(address: string): number {
  const octets = address.split('.').map(Number)
  const [a, b] = octets as [number, number]
  // Home-router defaults first.
  if (a === 192 && b === 168) return 0
  // Corporate/prosumer private LAN.
  if (a === 10) return 1
  // 172.16/12 is private too, but on dev machines it is very often a
  // Docker/VM bridge — below the clear home ranges.
  if (a === 172 && b >= 16 && b <= 31) return 2
  // CGNAT 100.64/10 (Tailscale et al.): reachable only for peers on the
  // same overlay network, not for a guest's phone.
  if (a === 100 && b >= 64 && b <= 127) return 3
  // Anything else (public, unusual): last resort.
  return 4
}

function isCandidate(iface: AddressLike): boolean {
  return (
    iface.family === 'IPv4' &&
    !iface.internal &&
    // Link-local (self-assigned, no DHCP) is never phone-reachable.
    !iface.address.startsWith('169.254.')
  )
}

/**
 * Pure core, unit-testable with fake interface maps: filter to viable
 * IPv4 candidates and sort private-LAN-first with a stable per-tier
 * address tiebreak (independent of OS interface enumeration order).
 */
export function orderLanAddresses(
  interfaces: Record<string, AddressLike[] | undefined>,
): string[] {
  return Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter(isCandidate)
    .map((iface) => iface.address)
    .sort((left, right) => tier(left) - tier(right) || left.localeCompare(right))
}

/** Phone-reachable IPv4 addresses, best candidate first. */
export function lanAddresses(): string[] {
  return orderLanAddresses(networkInterfaces())
}
