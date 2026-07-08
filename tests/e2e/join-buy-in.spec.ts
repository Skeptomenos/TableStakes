import { expect, test, type Browser, type Page } from '@playwright/test'

// Slice 3 browser evidence (ADR 0002): a phone joins an existing table,
// creates a profile, claims a seat, and explicitly confirms the fixed
// default buy-in — one tap, no amount entry. (The domain-level rejection
// of a non-default amount sent raw over the wire is proven at the
// integration layer in tests/integration/command-pipeline.test.ts,
// "rejects a non-default first buy-in sent over the command pipeline"
// — this spec covers the user-visible confirm flow.)

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

test('phone joins, claims a seat, and confirms the fixed default buy-in', async ({
  browser,
}) => {
  const console_ = await newDesktopPage(browser)
  await console_.goto('/console')
  const code = await createTableAndGetCode(console_)
  await expect(
    console_.locator('.share-card__code', { hasText: code }),
  ).toBeVisible()

  const player = await newPhone(browser)
  await player.goto(`/g/${code}`)
  await expect(player.getByText('Join Local Game')).toBeVisible()
  await player.getByPlaceholder('Name').fill('Sarah')
  await player.getByRole('button', { name: 'Create New Profile' }).click()

  await expect(player.getByText('Claim a seat')).toBeVisible()
  await player.getByRole('button', { name: 'Claim Seat' }).first().click()

  // Buy-in confirmation: the fixed default stated plainly, one primary
  // action, no amount entry anywhere.
  await expect(player.getByText('Confirm your buy-in')).toBeVisible()
  await expect(player.getByText('10 EUR = 1000 chips')).toBeVisible()
  expect(await player.locator('input[type="number"]').count()).toBe(0)
  expect(await player.getByRole('spinbutton').count()).toBe(0)

  await player
    .getByRole('button', { name: 'Buy in for 10 EUR → 1000 chips' })
    .click()

  // Confirmed: falls through to the wait/table panel with the default
  // stack credited.
  await expect(player.getByText('Table is set')).toBeVisible()
  await expect(player.locator('.seat-list__stack').first()).toHaveText('1000')

  // Only one player bought in: Start Hand carries the honest disabled
  // reason (DESIGN.md, ADR 0002).
  await expect(
    player.getByRole('button', { name: 'Start Hand' }),
  ).toBeDisabled()
  await expect(
    player.getByText('Waiting for a second player to buy in'),
  ).toBeVisible()
})

test('reclaiming a seat that already has chips skips the buy-in confirmation', async ({
  browser,
}) => {
  const console_ = await newDesktopPage(browser)
  await console_.goto('/console')
  const code = await createTableAndGetCode(console_)

  const context = await browser.newContext({ viewport: PORTRAIT })
  const player = await context.newPage()
  await player.goto(`/g/${code}`)
  await player.getByPlaceholder('Name').fill('Ben')
  await player.getByRole('button', { name: 'Create New Profile' }).click()
  await player.getByRole('button', { name: 'Claim Seat' }).first().click()
  await player
    .getByRole('button', { name: 'Buy in for 10 EUR → 1000 chips' })
    .click()
  await expect(player.getByText('Table is set')).toBeVisible()

  // Reload interrupts the seat; the same session/profile hint reclaims it
  // — already has chips, so the buy-in confirmation is skipped entirely.
  await player.reload()
  await expect(player.getByText('Claim a seat')).toBeVisible()
  await player.getByRole('button', { name: 'Reclaim' }).click()
  await expect(player.getByText('Table is set')).toBeVisible()
  expect(await player.getByText('Confirm your buy-in').count()).toBe(0)
})
