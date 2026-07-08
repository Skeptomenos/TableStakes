import { expect, test, type Browser, type Page } from '@playwright/test'

// Slice 3 browser evidence (ADR 0002): the table console creates and
// configures a table, shows the permanent share card, and its seat
// overview fills live as a phone claims a seat — the console never claims
// a seat itself (SeatOverview decision log).

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

test('console creates a table, shows the permanent share card, and its seat overview fills live', async ({
  browser,
}) => {
  const console_ = await newDesktopPage(browser)
  await console_.goto('/console')

  // Table settings: the SPEC.md example economy, strict mode default off.
  await expect(console_.getByText('Table settings')).toBeVisible()
  await expect(console_.getByLabel(/strict mode/i)).not.toBeChecked()
  await expect(console_.getByText('10 EUR = 1000 chips')).toBeVisible()

  // e2e specs share one long-lived server across the whole suite run, so
  // an older active table may already be auto-selected on mount (correct
  // product behavior: reopening /console during a live game should show
  // it). Read the NEW table's code from the actual POST /api/games
  // response, never by scraping the DOM right after the click — an older
  // table's ShareCard can already be present and would race a plain
  // locator read.
  const [response] = await Promise.all([
    console_.waitForResponse(
      (res) => res.url().endsWith('/api/games') && res.request().method() === 'POST',
    ),
    console_.getByRole('button', { name: 'Create Table' }).click(),
  ])
  const code = (await response.json()).code as string
  expect(code).toMatch(/^\d{5}$/)

  // Share card is permanent — visible immediately after creation, no
  // separate "start table" step.
  await expect(console_.locator('.share-card__code', { hasText: code })).toBeVisible()
  await expect(console_.getByText('Share this table')).toBeVisible()
  await expect(console_.locator('.share-card__qr svg')).toBeVisible()

  // Seat overview starts fully empty.
  await expect(console_.getByText('Seats')).toBeVisible()
  expect(await console_.getByText('[Empty]').count()).toBe(10)

  // No claim buttons anywhere on the console — it watches, never claims.
  expect(
    await console_.getByRole('button', { name: 'Claim Seat' }).count(),
  ).toBe(0)

  // A phone joins and claims a seat; the console's overview updates live
  // over the same socket connection, no reload.
  const player = await newPhone(browser)
  await player.goto(`/g/${code}`)
  await player.getByPlaceholder('Name').fill('Anna')
  await player.getByRole('button', { name: 'Create New Profile' }).click()
  await player.getByRole('button', { name: 'Claim Seat' }).first().click()

  await expect(console_.getByText('Anna — waiting to buy in')).toBeVisible()
  expect(await console_.getByText('[Empty]').count()).toBe(9)
})
