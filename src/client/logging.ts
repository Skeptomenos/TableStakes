import { sessionId } from './session'

// Phones ship warn/error evidence to the host so one log file holds the
// whole night (ARCHITECTURE.md Observability And Logging). Shipping is
// fire-and-forget and can never affect gameplay.

interface ClientLogEntry {
  level: 'error' | 'warn' | 'info'
  event: string
  msg: string
  context?: Record<string, unknown>
}

const FLUSH_INTERVAL_MS = 5000
const MAX_BATCH = 50

let buffer: ClientLogEntry[] = []
let gameCode: string | undefined
let started = false

export function setClientLogContext(code: string): void {
  gameCode = code
}

export function logClient(
  level: ClientLogEntry['level'],
  event: string,
  msg: string,
  context?: Record<string, unknown>,
): void {
  buffer.push({ level, event, msg, context })
  if (buffer.length > MAX_BATCH) buffer = buffer.slice(-MAX_BATCH)
  if (level === 'error') flush()
}

function payload(entries: ClientLogEntry[]): string {
  return JSON.stringify({ sessionId: sessionId(), gameCode, entries })
}

function flush(): void {
  if (buffer.length === 0) return
  const entries = buffer.splice(0, MAX_BATCH)
  try {
    void fetch('/api/client-logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload(entries),
    }).catch(() => {})
  } catch {
    // Never let log shipping break the client.
  }
}

/** Install global handlers and the periodic flush. Idempotent. */
export function initClientLogging(): void {
  if (started) return
  started = true

  window.addEventListener('error', (event) => {
    logClient('error', 'window.error', event.message, {
      source: event.filename,
      line: event.lineno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    logClient('error', 'window.unhandledrejection', String(reason), {
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })
  window.addEventListener('pagehide', () => {
    if (buffer.length === 0) return
    const entries = buffer.splice(0, MAX_BATCH)
    try {
      navigator.sendBeacon(
        '/api/client-logs',
        new Blob([payload(entries)], { type: 'application/json' }),
      )
    } catch {
      // best effort only
    }
  })
  setInterval(flush, FLUSH_INTERVAL_MS)
}
