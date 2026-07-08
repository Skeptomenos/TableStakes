import { expect, test, type Browser, type Page } from '@playwright/test'

// Slice 8 browser evidence: three phone-portrait clients play one complete
// normal hand — blinds, calls and checks, manual street confirmations, a
// river bet folded out to an uncontested auto-award, and next-hand
// advancement with the dealer button moving. Slice 3 (ADR 0002) changed
// only the setup preamble: the console creates+configures the table and
// phones confirm the fixed default buy-in instead of the old bundled
// host-profile-tap + SetupForm flow. Every in-hand assertion below is
// byte-identical to before the surface split — this spec is the
// regression net proving the choreography flip is behavior-neutral.

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

async function joinClaimAndConfirm(page: Page, code: string, name: string) {
  await page.goto(`/g/${code}`)
  await page.getByPlaceholder('Name').fill(name)
  await page.getByRole('button', { name: 'Create New Profile' }).click()
  await page.getByRole('button', { name: 'Claim Seat' }).first().click()
  await page
    .getByRole('button', { name: 'Buy in for 10 EUR → 1000 chips' })
    .click()
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

test('three phones play a normal hand through auto-award and next hand', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  // Console creates and configures the table (ADR 0002): settings only,
  // SPEC.md example economy defaults.
  const console_ = await newDesktopPage(browser)
  await console_.goto('/console')
  const code = await createTableAndGetCode(console_)
  await expect(
    console_.locator('.share-card__code', { hasText: code }),
  ).toBeVisible()

  // Three phones join, claim seats, and confirm the fixed default buy-in.
  const host = await newPhone(browser)
  await joinClaimAndConfirm(host, code, 'Hosta')
  const anna = await newPhone(browser)
  await joinClaimAndConfirm(anna, code, 'Anna')
  const ben = await newPhone(browser)
  await joinClaimAndConfirm(ben, code, 'Ben')

  // Console picks the first dealer (Hosta, seat 1, first to claim+confirm)
  // and starts the hand once 2+ players have bought in (console-primary,
  // ADR 0002).
  await expect(console_.getByText('First dealer')).toBeVisible()
  await console_.getByRole('radio').first().check()
  await console_.getByRole('button', { name: 'Start Hand' }).click()

  // Live table appears on every phone with blinds posted: dealer Hosta,
  // SB Anna, BB Ben; Hosta acts first pre-flop. Pucks are amount-less
  // (design uplift): blind AMOUNTS live in the action-bar context line.
  await expect(host.getByText('D', { exact: true })).toBeVisible()
  await expect(anna.getByText('SB', { exact: true })).toBeVisible()
  await expect(ben.getByText('BB', { exact: true })).toBeVisible()
  await expect(host.getByText('Your Turn')).toBeVisible()

  // No quick-chip preset bank anywhere.
  expect(await host.getByText(/\+1 BB|\+5 BB|half stack/i).count()).toBe(0)

  // Core in-hand layout must not scroll in phone portrait.
  const noScroll = await host.evaluate(
    () =>
      document.scrollingElement!.scrollHeight <=
      document.scrollingElement!.clientHeight + 1,
  )
  expect(noScroll).toBe(true)

  // Pre-flop: Hosta calls, Anna calls, Ben checks his option.
  await host.getByRole('button', { name: 'Call 100' }).click()
  await anna.getByRole('button', { name: 'Call 50' }).click()
  await ben.getByRole('button', { name: 'Check' }).click()

  // Betting closed: any player confirms the flop after dealing cards.
  await host.getByRole('button', { name: 'Next street' }).click()

  // Flop and turn: everyone checks (SB first post-flop).
  for (const street of ['turn', 'river'] as const) {
    await anna.getByRole('button', { name: 'Check' }).click()
    await ben.getByRole('button', { name: 'Check' }).click()
    await host.getByRole('button', { name: 'Check' }).click()
    await host.getByRole('button', { name: 'Next street' }).click()
    expect(street).toBeTruthy()
  }

  // River: Anna bets the suggested minimum (50); Ben and Hosta fold.
  await anna.getByRole('button', { name: 'Bet 50' }).click()
  await ben.getByRole('button', { name: 'Fold' }).click()
  await ben.getByRole('button', { name: 'Confirm Fold' }).click()
  await host.getByRole('button', { name: 'Fold' }).click()
  await host.getByRole('button', { name: 'Confirm Fold' }).click()

  // Uncontested auto-award: Anna wins 350 (300 pre-flop pot + her 50 back).
  // Stacks: Anna 1000 - 150 + 350 = 1200; Hosta and Ben 900 each.
  await expect(anna.getByText('1200')).toBeVisible()
  await expect(anna.getByRole('button', { name: 'Next Hand' })).toBeVisible()

  // Next hand: dealer button advances to Anna (seat 2).
  await anna.getByRole('button', { name: 'Next Hand' }).click()
  await expect(anna.getByText('D', { exact: true })).toBeVisible()
  const dealerCard = anna.locator('.player-card', {
    has: anna.getByText('D', { exact: true }),
  })
  await expect(dealerCard.getByText('Anna')).toBeVisible()

  // Landscape shows the rotate prompt.
  await ben.setViewportSize({ width: 844, height: 390 })
  await expect(ben.getByText(/rotate your phone/i)).toBeVisible()
  await ben.setViewportSize(PORTRAIT)
  await expect(ben.getByText(/rotate your phone/i)).not.toBeVisible()
})
