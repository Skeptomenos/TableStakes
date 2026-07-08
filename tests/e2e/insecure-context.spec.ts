import { expect, test } from '@playwright/test'

// Every real player device is an insecure context (plain HTTP over the
// LAN — see ARCHITECTURE.md Client Architecture > Insecure Contexts).
// This spec pins that the gate's baseURL is one too, so a future
// secure-context-only API dependency turns the suite red before a human
// ever scans a QR code.
test('the app is served as an insecure context (matches every real phone)', async ({
  page,
}) => {
  await page.goto('/')
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
})
