import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// Slice 7 browser evidence: host creates and shares a game; a player joins
// via /g/<code>, creates a profile, claims a seat, and completes compact
// first-hand setup with the 10 EUR = 1000 chips example economy.

const PORTRAIT = { width: 390, height: 844 }

async function newPortraitPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  await page.setViewportSize(PORTRAIT)
  return page
}

test('host shares a game and a player joins, claims a seat, and completes setup', async ({
  browser,
}) => {
  // Host: separate context = separate localStorage session.
  const hostContext = await browser.newContext()
  const host = await newPortraitPage(hostContext)
  await host.goto('/')
  await host.getByPlaceholder('Name').fill('Hosta')
  await host.getByRole('button', { name: 'Create New Profile' }).click()

  // Creating the profile starts the table and lands on /g/<code>.
  await host.waitForURL(/\/g\/\d{5}$/)
  const code = host.url().match(/\/g\/(\d{5})$/)![1]!

  // Share surface: QR, full URL, five-digit code.
  await expect(host.getByText('Share this table')).toBeVisible()
  await expect(host.locator('.share-card__qr svg')).toBeVisible()
  await expect(host.locator('.share-card__url')).toContainText(`/g/${code}`)
  await expect(host.locator('.share-card__code')).toHaveText(code)

  // Host claims seat 1.
  await expect(host.getByText('Claim a seat')).toBeVisible()
  await host.getByRole('button', { name: 'Claim Seat' }).first().click()
  await expect(host.getByText('First-hand setup')).toBeVisible()

  // Player: second context, phone portrait, joins by TYPING the code on
  // the home screen (DESIGN.md manual game-code input, Slice 12) — the
  // same end state as opening /g/<code> directly.
  const playerContext = await browser.newContext()
  const player = await newPortraitPage(playerContext)
  await player.goto('/')
  await player.getByLabel(/game code/i).fill(code)
  await player.getByRole('button', { name: 'Join', exact: true }).click()
  await player.waitForURL(`**/g/${code}`)
  await expect(player.getByText('Join Local Game')).toBeVisible()
  await player.getByPlaceholder('Name').fill('Sarah')
  await player.getByRole('button', { name: 'Create New Profile' }).click()

  // The host's seat shows locked; the player claims a free seat.
  await expect(player.getByText('Locked')).toBeVisible()
  await player.getByRole('button', { name: 'Claim Seat' }).first().click()

  // Compact one-screen setup with the money-to-chip relationship and
  // strict mode default off.
  await expect(player.getByText('First-hand setup')).toBeVisible()
  await expect(player.getByText('10 EUR = 1000 chips')).toBeVisible()
  await expect(player.getByLabel(/strict mode/i)).not.toBeChecked()

  // No PIN/password/token surfaces anywhere in the join flow.
  expect(await player.locator('input[type="password"]').count()).toBe(0)

  // Player selects the dealer and starts the game.
  await player.getByRole('radio').first().check()
  await player.getByRole('button', { name: 'Start Game' }).click()
  await expect(player.getByText('Table is set')).toBeVisible()

  // Default buy-ins credited both stacks.
  await expect(player.locator('.seat-list__stack').first()).toHaveText('1000')

  await hostContext.close()
  await playerContext.close()
})
