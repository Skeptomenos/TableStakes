import { defineConfig, devices } from '@playwright/test'

const port = 4173

// Committed Playwright harness (Decision Log 2026-07-02: browser E2E is
// tool-agnostic; Playwright chosen for the package-runnable smoke suite).
// The webServer boots the BUILT artifact, matching the smoke fidelity rule.
//
// baseURL uses a hostname Chromium treats as a non-secure origin, not
// 127.0.0.1 — every real player device reaches this app over plain HTTP
// on a LAN IP, an insecure context (ARCHITECTURE.md Client Architecture >
// Insecure Contexts). --host-resolver-rules maps it to loopback inside
// Chromium only; the webServer below still binds/polls 127.0.0.1:PORT in
// Node, unaffected by the browser-side resolver override.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://insecure.test:${port}`,
  },
  projects: [
    {
      name: 'phone-portrait-chromium',
      use: {
        // Phone portrait is the authoritative gameplay surface (SPEC.md).
        // Chromium engine override: only chromium is installed locally.
        ...devices['iPhone 14'],
        browserName: 'chromium',
        launchOptions: {
          args: ['--host-resolver-rules=MAP insecure.test 127.0.0.1'],
        },
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
