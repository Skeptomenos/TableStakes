import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// Felt & Ledger token contract (design uplift Slice 1): the locked palette
// from DESIGN.md must be the only color system in app.css. Values are
// asserted lowercase.

const css = readFileSync(
  path.resolve(__dirname, 'app.css'),
  'utf8',
).toLowerCase()

const LOCKED_TOKENS: Record<string, string> = {
  '--felt-950': '#0e1210',
  '--felt-900': '#151b17',
  '--felt-850': '#1b221e',
  '--hairline': '#2a332d',
  '--ivory': '#e9e5d9',
  '--ivory-dim': '#9aa39c',
  '--emerald-500': '#10b981',
  '--emerald-900': '#0b3b2c',
  '--amber-400': '#e8a33d',
  '--claret-500': '#a83e43',
}

// Deep Stack Logic values the uplift replaces.
const LEGACY_HEX = ['#4edea3', '#131313', '#1c1b1b', '#201f1f', '#bbcabf']

describe('Felt & Ledger tokens', () => {
  it('defines every locked token with its exact value', () => {
    for (const [name, value] of Object.entries(LOCKED_TOKENS)) {
      expect(css, `${name}: ${value}`).toContain(`${name}: ${value}`)
    }
  })

  it('contains no legacy Deep Stack Logic hex values', () => {
    for (const hex of LEGACY_HEX) {
      expect(css, `legacy ${hex} must be gone`).not.toContain(hex)
    }
  })

  it('defines the ledger numeral utility (mono + tabular figures)', () => {
    expect(css).toContain('--font-mono')
    expect(css).toMatch(/\.num\s*\{[^}]*font-family:\s*var\(--font-mono\)/)
    expect(css).toMatch(/\.num\s*\{[^}]*tabular-nums/)
  })

  it('keeps emerald off non-interactive headings (accent discipline)', () => {
    const title = css.match(/\.app-shell__title\s*\{[^}]*\}/)?.[0] ?? ''
    expect(title).not.toContain('--emerald')
    expect(title).not.toContain('--primary')
  })
})
