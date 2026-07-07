// crypto.randomUUID is SECURE-CONTEXT-ONLY: it exists on localhost but not
// on http://<lan-ip> — which is exactly how every phone reaches the host
// (SPEC.md local-first, no TLS). Calling it there threw on first paint and
// crashed the whole game route. crypto.getRandomValues has no such
// restriction, so build the v4 UUID from it when randomUUID is absent.

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // variant 10xx
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
