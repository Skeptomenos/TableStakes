import { expect, test, type Browser, type Page } from '@playwright/test'

// Slice 5 browser evidence (ADR 0002): the EXACT 2026-07-08 failure
// scenario, pinned permanently. A second device must find the existing
// table via the player landing's active-tables list — never create its
// own and see ten empty seats. Device B claims a DIFFERENT seat than
// device A/C and must see the first seat already taken.

const DESKTOP = { width: 1280, height: 800 }
const PORTRAIT = { width: 390, height: 844 }

async function newDesktopPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: DESKTOP })
  return context.newPage()
}

async function newPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: PORTRAIT })
  return context.newPage()
}

// e2e specs share one long-lived server across the whole suite run, so an
// older active table may already be auto-selected on /console mount
// (correct product behavior). Read the NEW table's code from the actual
// POST /api/games response, never by scraping the DOM right after the
// click.
async function createTableAndGetCode(console_: Page): Promise<string> {
  const [response] = await Promise.all([
    console_.waitForResponse(
      (res) => res.url().endsWith('/api/games') && res.request().method() === 'POST',
    ),
    console_.getByRole('button', { name: 'Create Table' }).click(),
  ])
  return (await response.json()).code as string
}

test('a second device finds the existing table from the landing instead of creating its own', async ({
  browser,
}) => {
  // Device A: the console creates the table.
  const console_ = await newDesktopPage(browser)
  await console_.goto('/console')
  const code = await createTableAndGetCode(console_)

  // Device C (first phone): joins directly via /g/<code> (the QR path),
  // claims seat 1, and confirms the fixed default buy-in.
  const deviceC = await newPhone(browser)
  await deviceC.goto(`/g/${code}`)
  await deviceC.getByPlaceholder('Name').fill('Priya')
  await deviceC.getByRole('button', { name: 'Create New Profile' }).click()
  await deviceC.getByRole('button', { name: 'Claim Seat' }).first().click()
  await deviceC
    .getByRole('button', { name: 'Buy in for 10 EUR → 1000 chips' })
    .click()
  await expect(deviceC.getByText('Table is set')).toBeVisible()

  // Device B: a second phone that reaches the BARE landing (`/`), not the
  // QR — the exact path that produced "ten empty seats" on 2026-07-08.
  // It must see the table B just watched device C fill, with the correct
  // seated count, and tap it instead of creating a table of its own (no
  // creation affordance exists on this surface at all). e2e specs share
  // one long-lived server across the whole suite run, so OTHER tables
  // with "1 seated" legitimately coexist — the row must be scoped to
  // THIS table's own code, never a bare text match.
  const deviceB = await newPhone(browser)
  await deviceB.goto('/')
  const row = deviceB.getByRole('button', { name: `#${code} 1 seated` })
  await expect(row).toBeVisible()
  await row.click()
  await deviceB.waitForURL(`**/g/${code}`)

  // Device B claims a DIFFERENT seat and must see seat 1 (Priya) already
  // taken — never "[Empty]" across all ten seats, the exact bug.
  await deviceB.getByPlaceholder('Name').fill('Marcus')
  await deviceB.getByRole('button', { name: 'Create New Profile' }).click()
  // Scoped to the seat list: a bare getByText('Priya') would also match
  // "Priya (Local)" in the profile picker and prove nothing about seats
  // (FINAL-verification finding).
  await expect(deviceB.locator('.seat-list__name', { hasText: 'Priya' })).toBeVisible()
  await expect(deviceB.getByText('Locked')).toBeVisible()
  // 10 seats total, exactly 1 filled (Priya): the OLD bug showed 10 empty
  // seats here — device B must see 9, never 10.
  expect(await deviceB.getByText('[Empty]').count()).toBe(9)

  await deviceB.getByRole('button', { name: 'Claim Seat' }).first().click()
  await deviceB
    .getByRole('button', { name: 'Buy in for 10 EUR → 1000 chips' })
    .click()
  await expect(deviceB.getByText('Table is set')).toBeVisible()

  // Both phones are seated at the SAME table (2 seated), not two separate
  // one-player tables.
  await expect(deviceB.getByText('2 players seated')).toBeVisible()
})
