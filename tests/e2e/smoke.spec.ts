import { expect, test } from '@playwright/test'

// Browser smoke for the Slice 0 app shell: phone portrait viewport, zero
// console errors, visible shell content on both / and a game URL.
test('app shell renders in phone portrait without console errors', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Poker Chip Counter' }),
  ).toBeVisible()

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  expect(viewport!.width).toBeLessThan(viewport!.height)

  expect(consoleErrors).toEqual([])
})

test('game URLs serve the app shell', async ({ page }) => {
  await page.goto('/g/48317')
  await expect(
    page.getByRole('heading', { name: 'Poker Chip Counter' }),
  ).toBeVisible()
})
