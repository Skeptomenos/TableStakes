import { expect, test, type Browser, type Page } from '@playwright/test'

// Slice 9 browser evidence: a short-stack all-in creates a side pot; the
// table settles main pot then side pot in display order, uses split mode
// with live remaining feedback, and Next Hand stays gated until all pots
// settle. Slice 3 (ADR 0002) changed only the setup preamble: the console
// creates+configures the table and phones confirm the fixed default
// buy-in. Every in-hand/settlement assertion below is byte-identical to
// before the surface split — this spec is the regression net proving the
// choreography flip is behavior-neutral.

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

async function exactRaise(page: Page, amount: number, label: string) {
  await page.getByTestId('amount-display').click()
  await page.getByRole('spinbutton').fill(String(amount))
  await page.getByRole('button', { name: label }).click()
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

test('side pots settle in display order with exact splits and Next Hand gating', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const console_ = await newDesktopPage(browser)
  await console_.goto('/console')
  const code = await createTableAndGetCode(console_)
  await expect(
    console_.locator('.share-card__code', { hasText: code }),
  ).toBeVisible()

  const hosta = await newPhone(browser)
  await joinClaimAndConfirm(hosta, code, 'Hosta')
  const anna = await newPhone(browser)
  await joinClaimAndConfirm(anna, code, 'Anna')
  const ben = await newPhone(browser)
  await joinClaimAndConfirm(ben, code, 'Ben')

  await expect(console_.getByText('First dealer')).toBeVisible()
  await console_.getByRole('radio').first().check()
  await console_.getByRole('button', { name: 'Start Hand' }).click()

  // HAND 1 — create unequal stacks. Dealer Hosta, SB Anna 50, BB Ben 100.
  // Hosta raises to 500, Anna calls, Ben folds; checked to showdown.
  await exactRaise(hosta, 500, 'Raise 500')
  await anna.getByRole('button', { name: 'Call 450' }).click()
  await ben.getByRole('button', { name: 'Fold' }).click()
  await ben.getByRole('button', { name: 'Confirm Fold' }).click()
  for (let i = 0; i < 4; i++) {
    await hosta.getByRole('button', { name: 'Next street' }).click()
    if (i < 3) {
      await anna.getByRole('button', { name: 'Check' }).click()
      await hosta.getByRole('button', { name: 'Check' }).click()
    }
  }

  // Settlement 1: single main pot 1100; Hosta takes all eligible.
  await expect(hosta.getByText('Hand Settlement')).toBeVisible()
  await expect(hosta.getByText('Total Pot Size 1100')).toBeVisible()
  await hosta.getByRole('radio', { name: /Hosta/ }).check()
  await hosta.getByRole('button', { name: 'Take All Eligible' }).click()
  await hosta.getByRole('button', { name: 'Confirm Take All' }).click()

  // Stacks now: Hosta 1600, Anna 500, Ben 900. Dealer advances to Anna.
  await expect(hosta.getByRole('button', { name: 'Next Hand' })).toBeEnabled()
  await hosta.getByRole('button', { name: 'Next Hand' }).click()

  // HAND 2 — dealer Anna, SB Ben 50, BB Hosta 100; Anna acts first and
  // goes all-in for her 500: the short stack that seeds the side pot.
  await expect(anna.getByText('Your Turn')).toBeVisible()
  await anna.getByRole('button', { name: 'All-In' }).click()
  await anna.getByRole('button', { name: 'Confirm All-In' }).click()
  await ben.getByRole('button', { name: 'Call 450' }).click()
  await hosta.getByRole('button', { name: 'Call 400' }).click()

  // Flop: Ben bets 200 into Hosta only — chips above Anna's cap.
  await ben.getByRole('button', { name: 'Next street' }).click()
  await ben.getByRole('button', { name: 'Bet 50' }).isVisible()
  await exactRaise(ben, 200, 'Bet 200')
  await hosta.getByRole('button', { name: 'Call 200' }).click()

  // Run out to showdown.
  await ben.getByRole('button', { name: 'Next street' }).click()
  for (const page of [ben, hosta]) {
    await page.getByRole('button', { name: 'Check' }).click()
  }
  await ben.getByRole('button', { name: 'Next street' }).click()
  for (const page of [ben, hosta]) {
    await page.getByRole('button', { name: 'Check' }).click()
  }
  await ben.getByRole('button', { name: 'Next street' }).click()

  // Settlement 2: Main Pot 1500 (all three) + Side Pot 1 400 (Ben, Hosta).
  await expect(anna.getByText('Hand Settlement')).toBeVisible()
  await expect(anna.getByText('Total Pot Size 1900')).toBeVisible()
  await expect(
    anna.locator('.settlement__pot-label', { hasText: 'Side Pot 1' }),
  ).toBeVisible()

  // Anna is not eligible for the side pot: no Take All Eligible for her.
  await anna.getByRole('radio', { name: /Anna/ }).check()
  await expect(
    anna.getByRole('button', { name: 'Take All Eligible' }),
  ).toHaveCount(0)
  // Next Hand stays disabled while pots are unresolved.
  await expect(anna.getByRole('button', { name: 'Next Hand' })).toBeDisabled()

  // Pot-by-pot in display order: award the main pot to Anna.
  await anna.getByRole('button', { name: 'Award Main Pot' }).click()
  await anna.getByRole('button', { name: 'Confirm Award' }).click()

  // The main pot shows Settled; the side pot is now the actionable one.
  await expect(anna.getByText('Settled')).toBeVisible()

  // Split the side pot between Ben and Hosta via the chop-selection flow
  // (ADR 0003): checkbox both, get the instant even 200/200 split with zero
  // mental arithmetic, adjust once via the 2-player slider to prove it
  // stays zero-sum, then settle back on the even split.
  await ben.getByRole('button', { name: 'Split Pot' }).click()
  await expect(ben.getByText('Remaining: 400')).toBeVisible()
  await ben.getByRole('checkbox', { name: 'Ben' }).check()
  await ben.getByRole('checkbox', { name: 'Hosta' }).check()
  // Auto-even split on selection: shares render immediately, never zero.
  await expect(ben.getByLabel('Split for Ben')).toHaveValue('200')
  await expect(ben.getByLabel('Split for Hosta')).toHaveValue('200')
  await expect(ben.getByText('Remaining: 0')).toBeVisible()
  await expect(ben.getByRole('button', { name: 'Confirm Split' })).toBeEnabled()

  // Exactly 2 selected: one zero-sum slider between the two shares. Range
  // inputs cannot be `.fill()`ed in Playwright; step via keyboard (native
  // range-input behavior moves by the `step` attribute per arrow press —
  // the table's small blind, 50, per ADR 0003's amount-step resolution).
  const hostaShare = ben.getByRole('slider', { name: "Hosta's share" })
  await hostaShare.focus()
  await ben.keyboard.press('ArrowRight')
  await expect(ben.getByLabel('Split for Hosta')).toHaveValue('250')
  await expect(ben.getByLabel('Split for Ben')).toHaveValue('150')
  await expect(ben.getByText('Remaining: 0')).toBeVisible()
  await ben.keyboard.press('ArrowLeft')
  await expect(ben.getByLabel('Split for Hosta')).toHaveValue('200')
  await expect(ben.getByText('Remaining: 0')).toBeVisible()

  await ben.getByRole('button', { name: 'Confirm Split' }).click()
  await ben.getByRole('button', { name: 'Yes, Split' }).click()

  // All pots settled: back to between-hands with correct stacks.
  // Anna 1500; Ben 900-700+200 = 400; Hosta 1600-700+200 = 1100.
  await expect(anna.getByRole('button', { name: 'Next Hand' })).toBeEnabled()
  await expect(anna.getByText('1500')).toBeVisible()
  await expect(ben.getByText('400', { exact: true })).toBeVisible()
  await expect(hosta.getByText('1100')).toBeVisible()
})
