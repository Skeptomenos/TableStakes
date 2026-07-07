import { expect, test, type Browser, type Page } from '@playwright/test'

// Slice 8 browser evidence: three phone-portrait clients play one complete
// normal hand — blinds, calls and checks, manual street confirmations, a
// river bet folded out to an uncontested auto-award, and next-hand
// advancement with the dealer button moving.

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

test('three phones play a normal hand through auto-award and next hand', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  // Host creates the game and claims seat 1.
  const host = await newPhone(browser)
  await host.goto('/')
  await host.getByPlaceholder('Name').fill('Hosta')
  await host.getByRole('button', { name: 'Create New Profile' }).click()
  await host.waitForURL(/\/g\/\d{5}$/)
  const code = host.url().match(/\/g\/(\d{5})$/)![1]!
  await host.getByRole('button', { name: 'Claim Seat' }).first().click()

  // Two more phones join and claim the next seats.
  const anna = await newPhone(browser)
  await joinAndClaim(anna, code, 'Anna')
  const ben = await newPhone(browser)
  await joinAndClaim(ben, code, 'Ben')

  // Host completes setup: dealer = Hosta (seat 1), defaults 10 EUR = 1000.
  await expect(host.getByText('First-hand setup')).toBeVisible()
  await host.getByRole('radio').first().check()
  await host.getByRole('button', { name: 'Start Game' }).click()
  await expect(host.getByText('Table is set')).toBeVisible()
  await host.getByRole('button', { name: 'Start Hand' }).click()

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
