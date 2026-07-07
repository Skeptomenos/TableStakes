import { expect, test, type Browser, type Page } from '@playwright/test'

// Slice 9 browser evidence: a short-stack all-in creates a side pot; the
// table settles main pot then side pot in display order, uses split mode
// with live remaining feedback, and Next Hand stays gated until all pots
// settle.

const PORTRAIT = { width: 390, height: 844 }

async function newPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: PORTRAIT })
  return context.newPage()
}

async function joinAndClaim(page: Page, code: string, name: string) {
  await page.goto(`/g/${code}`)
  await page.getByPlaceholder('Name').fill(name)
  await page.getByRole('button', { name: 'Create New Profile' }).click()
  await page.getByRole('button', { name: 'Claim Seat' }).first().click()
}

async function exactRaise(page: Page, amount: number, label: string) {
  await page.getByTestId('amount-display').click()
  await page.getByRole('spinbutton').fill(String(amount))
  await page.getByRole('button', { name: label }).click()
}

test('side pots settle in display order with exact splits and Next Hand gating', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const hosta = await newPhone(browser)
  await hosta.goto('/')
  await hosta.getByPlaceholder('Name').fill('Hosta')
  await hosta.getByRole('button', { name: 'Create New Profile' }).click()
  await hosta.waitForURL(/\/g\/\d{5}$/)
  const code = hosta.url().match(/\/g\/(\d{5})$/)![1]!
  await hosta.getByRole('button', { name: 'Claim Seat' }).first().click()

  const anna = await newPhone(browser)
  await joinAndClaim(anna, code, 'Anna')
  const ben = await newPhone(browser)
  await joinAndClaim(ben, code, 'Ben')

  await hosta.getByRole('radio').first().check()
  await hosta.getByRole('button', { name: 'Start Game' }).click()
  await hosta.getByRole('button', { name: 'Start Hand' }).click()

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

  // Split the side pot 200/200 between Ben and Hosta with live feedback.
  await ben.getByRole('button', { name: 'Split Pot' }).click()
  await expect(ben.getByText('Remaining: 400')).toBeVisible()
  await ben.getByLabel('Split for Ben').fill('200')
  await expect(ben.getByText('Remaining: 200')).toBeVisible()
  await expect(ben.getByRole('button', { name: 'Confirm Split' })).toBeDisabled()
  await ben.getByLabel('Split for Hosta').fill('200')
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
