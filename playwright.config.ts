import { defineConfig, devices } from '@playwright/test'

const port = 4173

// Committed Playwright harness (Decision Log 2026-07-02: browser E2E is
// tool-agnostic; Playwright chosen for the package-runnable smoke suite).
// The webServer boots the BUILT artifact, matching the smoke fidelity rule.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  projects: [
    {
      name: 'phone-portrait-chromium',
      use: {
        // Phone portrait is the authoritative gameplay surface (SPEC.md).
        // Chromium engine override: only chromium is installed locally.
        ...devices['iPhone 14'],
        browserName: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'rm -rf .e2e-data && node dist/server.mjs',
    port,
    env: { PORT: String(port), PCC_DB_PATH: '.e2e-data/e2e.db' },
    reuseExistingServer: false,
  },
})
