// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './components/ErrorBoundary'
import { logClient } from './logging'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('logClient / flush', () => {
  it('ships the batch with sessionId "unknown" when session identity throws (SecurityError-like storage)', async () => {
    // Regression (incident 2026-07-08): sessionId() -> crypto.randomUUID()
    // threw on insecure-context clients; flush() had already spliced the
    // buffer, so the catch swallowed the entries and nothing reached the
    // host. localStorage throwing (SecurityError in storage-disabled
    // configurations) is a second, independent way sessionId() can fail —
    // the pipeline must survive that too.
    const fetchMock = stubFetch()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage disabled', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage disabled', 'SecurityError')
    })

    logClient('error', 'x', 'y')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/client-logs')
    const body = JSON.parse(init.body as string) as {
      sessionId: string
      entries: Array<{ event: string; msg: string }>
    }
    expect(body.sessionId).toBe('unknown')
    expect(body.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'x', msg: 'y' })]),
    )
  })
})

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Simulate an insecure-context client: crypto.randomUUID absent.
    // getRandomValues stays real so uuid()'s fallback path still works.
    vi.stubGlobal('crypto', {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    })
  })

  function Boom(): never {
    throw new Error('render-boom')
  }

  it('ships a react.error batch with stack and componentStack when a child crashes', () => {
    const fetchMock = stubFetch()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      entries: Array<{ event: string; msg: string; context?: Record<string, unknown> }>
    }
    const reactError = body.entries.find((e) => e.event === 'react.error')
    expect(reactError).toBeDefined()
    expect(reactError?.msg).toBe('render-boom')
    expect(typeof reactError?.context?.stack).toBe('string')
    expect(typeof reactError?.context?.componentStack).toBe('string')

    consoleError.mockRestore()
  })
})
