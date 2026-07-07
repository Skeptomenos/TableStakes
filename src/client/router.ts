import { useEffect, useState } from 'react'

// Two top-level routes (/ and /g/<code>) do not justify a router library:
// pathname state plus pushState covers the MVP (Decision Log 2026-07-02).

export function navigate(path: string): void {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])
  return path
}
