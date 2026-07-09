import { expect, test, type Browser, type Page } from '@playwright/test'

// ADR 0003 Slice 3: the full bust -> rebuy -> continue loop as a permanent
// gate case. Heads-up (2 players) is the simplest way to guarantee a bust:
// both go all-in pre-flop for equal stacks, run to showdown, award the full
// pot to one side, and the other lands at exactly 0 chips with
// handStatus 'needs-rebuy'. From there: the busted player's OWN device
// shows the prompt card; the OTHER player's device shows the Needs rebuy
// pill and a disabled, reasoned Next Hand; the busted player one-taps the
// default rebuy; Next Hand re-enables and a second hand plays out.

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

test('bust -> rebuy -> continue: prompt, pill, gated Next Hand, then a second hand', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  const console_ = await newDesktopPage(browser)
  await console_.goto('/console')
  const code = await createTableAndGetCode(console_)
  await expect(
    console_.locator('.share-card__code', { hasText: code }),
  ).toBeVisible()

  // Heads-up: 2 players, 10 EUR -> 1000 chips each (table default).
  const hosta = await newPhone(browser)
  await joinClaimAndConfirm(hosta, code, 'Hosta')
  const anna = await newPhone(browser)
  await joinClaimAndConfirm(anna, code, 'Anna')

  await expect(console_.getByText('First dealer')).toBeVisible()
  await console_.getByRole('radio').first().check()
  await console_.getByRole('button', { name: 'Start Hand' }).click()

  // Heads-up: dealer (Hosta) posts SB and acts first pre-flop.
  await expect(hosta.getByText('Your Turn')).toBeVisible()

  // Both go all-in for equal 1000-chip stacks: no side pot, straight to
  // showdown once both are all-in (neither is actionable any more).
  await hosta.getByRole('button', { name: 'All-In', exact: true }).click()
  await hosta.getByRole('button', { name: 'Confirm All-In' }).click()
  await anna.getByRole('button', { name: 'All-In', exact: true }).click()
  await anna.getByRole('button', { name: 'Confirm All-In' }).click()

  // No further action is possible pre-flop; each street just confirms.
  for (let i = 0; i < 4; i++) {
    await hosta.getByRole('button', { name: 'Next street' }).click()
  }

  // Settlement: single main pot of 2000. Award it all to Hosta — Anna
  // busts to exactly 0.
  await expect(hosta.getByText('Hand Settlement')).toBeVisible()
  await expect(hosta.getByText('Total Pot Size 2000')).toBeVisible()
  await hosta.getByRole('radio', { name: /Hosta/ }).check()
  await hosta.getByRole('button', { name: 'Take All Eligible' }).click()
  await hosta.getByRole('button', { name: 'Confirm Take All' }).click()

  // Anna's OWN device: the needs-rebuy prompt card, with the exact
  // default-rebuy copy from the table settings (10 EUR -> 1000 chips).
  await expect(anna.getByText("You're out of chips.")).toBeVisible()
  await expect(
    anna.getByRole('button', { name: 'Rebuy 10 EUR → 1000 chips' }),
  ).toBeVisible()
  await expect(anna.getByRole('button', { name: 'Custom rebuy' })).toBeVisible()
  await expect(anna.getByRole('button', { name: 'Sit out' })).toBeVisible()

  // The OTHER player's device: no prompt card for them, but the table-wide
  // Needs rebuy pill on Anna's seat, and Next Hand disabled with the
  // domain's own reason instead of a live button that would only reject.
  await expect(hosta.getByText("You're out of chips.")).not.toBeVisible()
  await expect(hosta.getByText('Needs rebuy')).toBeVisible()
  await expect(hosta.getByRole('button', { name: 'Next Hand' })).toBeDisabled()
  await expect(
    hosta.getByText('Waiting for players to rebuy — need 2 with chips'),
  ).toBeVisible()

  // Anna one-taps the default rebuy and confirms.
  await anna.getByRole('button', { name: 'Rebuy 10 EUR → 1000 chips' }).click()
  await anna.getByRole('button', { name: 'Confirm Rebuy' }).click()

  // Prompt gone, pill gone, stack restored to exactly the default 1000
  // chips, Next Hand enabled on both devices.
  await expect(anna.getByText("You're out of chips.")).not.toBeVisible()
  await expect(hosta.getByText('Needs rebuy')).not.toBeVisible()
  await expect(anna.locator('.player-card--me .player-card__stack')).toHaveText('1000')
  await expect(hosta.getByRole('button', { name: 'Next Hand' })).toBeEnabled()
  await expect(anna.getByRole('button', { name: 'Next Hand' })).toBeEnabled()

  // A second hand plays out. The dead-button rule (hand-reducer.ts) fixed
  // the dealer seat to Hosta the moment hand 1 closed — Anna was
  // needs-rebuy (not dealt-in) at exactly that instant, so the button
  // could not land on her and stayed put. Her later rebuy does not move
  // it retroactively: Hosta is still dealer/SB and acts first heads-up.
  await hosta.getByRole('button', { name: 'Next Hand' }).click()
  await expect(hosta.getByText('Your Turn')).toBeVisible()
  await hosta.getByRole('button', { name: 'Call 50' }).click()
  await anna.getByRole('button', { name: 'Check' }).click()
})
