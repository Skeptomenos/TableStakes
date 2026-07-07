// Observable end-to-end dogfood: plays a full scripted poker night against
// the BUILT artifact in a HEADED Chrome window (the human watches seat 1,
// "Dave"), with two in-process socket bots as the other players. Covers the
// Part D steps of _planning/verification/2026-07-06-final-verification.md
// with exact pre-computed chip values, including a real server restart.
//
// Run outside the CC sandbox (it binds ports and opens a GUI browser):
//   pnpm build && node scripts/dogfood/headed-game.mjs
// or via the `pcc-headed` launch config. SLOWMO=600 slows it down further.
// Progress: the headed window itself, stdout, http://127.0.0.1:4313 (live
// report), and .dogfood-data/headed-report.txt.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { io } from 'socket.io-client'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = path.join(appDir, '.dogfood-data')
const dbPath = path.join(dataDir, 'headed.db')
const logDir = path.join(dataDir, 'logs')
const reportPath = path.join(dataDir, 'headed-report.txt')
const APP = 'http://127.0.0.1:4310'
const SLOWMO = Number(process.env.SLOWMO ?? 350)

// ---------- report ----------
let reportText = `HEADED DOGFOOD RUN — ${new Date().toISOString()}\n\n`
function report(line) {
  console.log(line)
  reportText += line + '\n'
  appendFileSync(reportPath, line + '\n')
}
function pass(step, detail) {
  report(`PASS ${step} — ${detail}`)
}
function fail(step, detail) {
  report(`FAIL ${step} — ${detail}`)
  throw new Error(`${step}: ${detail}`)
}
function check(step, condition, detail) {
  if (condition) pass(step, detail)
  else fail(step, detail)
}

// Live report page (also satisfies the launch-config port probe).
createServer((_req, res) => {
  res.setHeader('content-type', 'text/html')
  res.end(
    `<meta http-equiv="refresh" content="2"><body style="background:#131313;color:#d5d8d2;font:13px monospace"><pre>${reportText
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')}</pre></body>`,
  )
}).listen(4313, '127.0.0.1')

// ---------- server lifecycle ----------
let serverChild = null
async function startServer() {
  serverChild = spawn('node', [path.join(appDir, 'dist', 'server.mjs')], {
    env: { ...process.env, PORT: '4310', PCC_DB_PATH: dbPath, PCC_LOG_DIR: logDir },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${APP}/healthz`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('server did not come up on 4310')
}
async function stopServer() {
  if (!serverChild) return
  const exited = new Promise((resolve) => serverChild.once('exit', resolve))
  serverChild.kill('SIGTERM')
  await exited
  serverChild = null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Stopping the pcc-headed task must not orphan the game server child.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    serverChild?.kill('SIGTERM')
    process.exit(0)
  })
}

// ---------- socket bots ----------
function makeBot(name) {
  return {
    name,
    profileId: null,
    sessionId: `headed-bot-${name}-${Math.random().toString(36).slice(2, 10)}`,
    socket: null,
    snapshot: null,
  }
}
async function botCreateProfile(bot) {
  const res = await fetch(`${APP}/api/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: bot.name }),
  })
  bot.profileId = (await res.json()).profileId
}
function botConnect(bot, code) {
  bot.socket = io(APP, {
    auth: { gameCode: code, sessionId: bot.sessionId },
    transports: ['websocket'],
  })
  bot.socket.on('snapshot', ({ snapshot }) => {
    bot.snapshot = snapshot
  })
  return new Promise((resolve, reject) => {
    bot.socket.once('connect', resolve)
    bot.socket.once('connect_error', reject)
  })
}
function botCommand(bot, command) {
  return new Promise((resolve, reject) => {
    const id = `hd-${bot.name}-${Math.random().toString(36).slice(2, 10)}`
    const onAck = (p) => {
      if (p.id !== id) return
      cleanup()
      resolve()
    }
    const onRej = (p) => {
      if (p.id !== id) return
      cleanup()
      reject(new Error(`${bot.name} ${command._tag} rejected: ${p.reason}`))
    }
    const cleanup = () => {
      bot.socket.off('command-ack', onAck)
      bot.socket.off('command-rejected', onRej)
    }
    bot.socket.on('command-ack', onAck)
    bot.socket.on('command-rejected', onRej)
    bot.socket.emit('command', { id, command })
    setTimeout(() => {
      cleanup()
      reject(new Error(`${bot.name} ${command._tag} ack timeout`))
    }, 6000)
  })
}
async function botWait(bot, predicate, what, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (bot.snapshot && predicate(bot.snapshot)) return bot.snapshot
    await sleep(120)
  }
  throw new Error(`timeout waiting for: ${what}`)
}
const stackOf = (snapshot, name) => snapshot.players.find((p) => p.name === name)?.stack

// ---------- main ----------
async function main() {
  rmSync(dataDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(reportPath, '')
  report(`slowMo=${SLOWMO}ms — watch the Chrome window (phone portrait)`)

  await startServer()
  report('server up on 4310 (fresh DB)')

  const browser = await chromium.launch({ headless: false, slowMo: SLOWMO })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const hardErrors = []
  const netNoise = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (/Failed to load resource|net::ERR|ERR_CONNECTION|WebSocket/.test(text)) netNoise.push(text)
    else hardErrors.push(text)
  })
  page.on('pageerror', (error) => hardErrors.push(String(error)))

  const button = (name) => page.getByRole('button', { name, exact: true })

  // ---- D.1 create + share ----
  await page.goto(`${APP}/`)
  await page.getByPlaceholder('Name').fill('Dave')
  await button('Create New Profile').click()
  await page.waitForURL(/\/g\/\d{5}$/)
  const code = page.url().match(/\/g\/(\d{5})$/)[1]
  await page.locator('.share-card__qr svg').waitFor()
  const shareUrl = await page.locator('.share-card__url').textContent()
  const shareCode = await page.locator('.share-card__code').textContent()
  check('D.1', shareUrl.includes(`/g/${code}`) && shareCode === code,
    `game ${code}; share card shows QR + URL (${shareUrl.trim()}) + code`)

  // ---- D.2 manual-code join ----
  await page.goto(`${APP}/`)
  await page.getByLabel(/game code/i).fill(code)
  await button('Join').click()
  await page.waitForURL(`**/g/${code}`)
  await page.getByText('Claim a seat').waitFor()
  pass('D.2', `typed ${code} on the home screen; Join routed to /g/${code}; remembered profile skipped re-selection`)

  // ---- D.3 seats, lock icons, setup, first hand ----
  const bea = makeBot('Bea')
  const cal = makeBot('Cal')
  for (const bot of [bea, cal]) {
    await botCreateProfile(bot)
    await botConnect(bot, code)
  }
  await botCommand(bea, { _tag: 'claim-seat', seatIndex: 1, profileId: bea.profileId })
  await botCommand(cal, { _tag: 'claim-seat', seatIndex: 2, profileId: cal.profileId })
  await page.getByText('Locked').first().waitFor()
  const lockIcons = await page.locator('.badge--locked svg').count()
  check('D.3a', lockIcons === 2, `both bot seats show Locked with the lock icon (${lockIcons} SVGs)`)

  await page.getByRole('button', { name: 'Claim Seat' }).first().click()
  await page.getByText('First-hand setup').waitFor()
  await page.getByText('10 EUR = 1000 chips').waitFor()
  const strictOff = !(await page.getByLabel(/strict mode/i).isChecked())
  check('D.3b', strictOff, 'one-screen setup shows 10 EUR = 1000 chips with strict mode default OFF')
  await page.getByRole('radio', { name: 'Dave' }).check()
  await button('Start Game').click()
  await page.getByText('Table is set').waitFor()
  await button('Start Hand').click()
  await botWait(bea, (s) => s.game.status === 'in-hand', 'hand 1 started')
  await page.getByText('SB 50').waitFor()
  await page.getByText('BB 100').waitFor()
  await page.getByText('Your Turn').waitFor()
  pass('D.3c', 'hand 1: D on Dave, SB 50 on Bea, BB 100 on Cal, Dave to act — stacks 1000 each before blinds')

  // ---- D.4 soft-mode below-minimum exact raise ----
  await page.locator('button.action-panel__amount').click()
  await page.locator('input.action-panel__exact').fill('120')
  await page.getByText(/below the minimum of 150/).waitFor()
  pass('D.4a', 'exact entry 120 < min 150 shows the amber soft-mode warning')
  await button('Raise 120').click()
  await botCommand(bea, { _tag: 'call' })
  await botCommand(cal, { _tag: 'call' })
  const afterH1Preflop = await botWait(
    bea,
    (s) => s.hand?.nextStreetReady === true,
    'hand 1 pre-flop closed',
  )
  const equalized = ['Dave', 'Bea', 'Cal'].every((n) => stackOf(afterH1Preflop, n) === 880)
  check('D.4b', equalized, 'below-minimum raise COMMITTED in soft mode; all stacks equalized at 880')

  // ---- D.5 streets to showdown, gated award, take-all ----
  for (const street of ['flop', 'turn', 'river']) {
    await button('Next street').click()
    await botWait(bea, (s) => s.hand?.street === street, `street ${street}`)
    await botCommand(bea, { _tag: 'check' })
    await botCommand(cal, { _tag: 'check' })
    await page.getByRole('button', { name: /^Check$/ }).click()
    await botWait(bea, (s) => s.hand?.nextStreetReady === true, `${street} closed`)
  }
  await button('Next street').click()
  await botWait(bea, (s) => s.game.status === 'showdown', 'showdown')
  await page.getByText('Total Pot Size 360').waitFor()
  const awardDisabled = await button('Award Main Pot').isDisabled()
  check('D.5a', awardDisabled, 'Award is gated until a winner is selected')
  await page.getByRole('radio', { name: /Bea/ }).check()
  await button('Take All Eligible').click()
  await page.getByText(/Bea receives 360 chips/).waitFor()
  await button('Confirm Take All').click()
  const afterH1 = await botWait(bea, (s) => s.game.status === 'between-hands', 'hand 1 settled')
  check('D.5b', stackOf(afterH1, 'Bea') === 1240,
    `Take All Eligible awarded 360 to Bea (stacks Dave ${stackOf(afterH1, 'Dave')}, Bea ${stackOf(afterH1, 'Bea')}, Cal ${stackOf(afterH1, 'Cal')})`)

  // ---- D.6 settings flip + zero-sum correction ----
  await button('Manage').click()
  await button('Settings').click()
  // Controlled inputs: state flips only after the server snapshot returns,
  // so click + wait on the bot snapshot instead of Playwright's check().
  await page.getByLabel(/strict mode/i).click()
  await botWait(bea, (s) => s.game.settings.strictMode === true, 'strict mode on')
  await page.getByLabel(/raise rule/i).selectOption('double')
  await botWait(bea, (s) => s.game.settings.raiseRule === 'double', 'double rule on')
  await button('Back').click()
  await button('Move Chips (Correction)').click()
  // The selects live INSIDE their <label>, so the accessible name is
  // polluted with option text — target by position (From, To).
  const correctionSelects = page.locator('.manage-drawer__form select')
  await correctionSelects.nth(0).selectOption({ label: 'Cal (stack)' })
  await correctionSelects.nth(1).selectOption({ label: 'Bea (stack)' })
  await page.locator('.manage-drawer__form input[type="number"]').fill('600')
  await page.locator('.manage-drawer__form input[type="text"]').fill('seed short stack for side-pot test')
  await button('Review Correction').click()
  await button('Confirm Correction').click()
  const afterCorrection = await botWait(bea, (s) => stackOf(s, 'Cal') === 280, 'correction applied')
  const conserved = stackOf(afterCorrection, 'Dave') + stackOf(afterCorrection, 'Bea') + stackOf(afterCorrection, 'Cal') === 3000
  check('D.6', stackOf(afterCorrection, 'Bea') === 1840 && conserved,
    `strict+double set for next hand; correction moved 600 Cal→Bea (280/1840/880 — total conserved at 3000)`)

  // ---- D.7 strict hand: legal double, all-in below min, strict block ----
  await button('Next Hand').click()
  await botWait(bea, (s) => s.game.status === 'in-hand' && s.hand?.activeSeat === 1, 'hand 2: Bea to act')
  await botCommand(bea, { _tag: 'raise', amount: 200 })
  await botCommand(cal, { _tag: 'go-all-in' })
  await botWait(bea, (s) => s.hand?.activeSeat === 0, 'Dave to act facing 280')
  await page.locator('button.action-panel__amount').click()
  await page.locator('input.action-panel__exact').fill('300')
  // Double rule: min raise-to = 2 x currentBet = 2 x 280 (Cal's shove) = 560.
  await page.getByText('Strict mode: minimum is 560.').waitFor()
  const raiseBlocked = await page.getByRole('button', { name: 'Raise 300' }).isDisabled()
  const callEnabled = !(await button('Call 180').isDisabled())
  check('D.7a', raiseBlocked && callEnabled,
    'strict + double: exact 300 < min 560 blocked (Raise disabled, message shown) while Call 180 stays enabled; Cal all-in 280 below min was accepted')
  await button('Call 180').click()
  await botCommand(bea, { _tag: 'call' })
  const h2Closed = await botWait(bea, (s) => s.hand?.nextStreetReady === true, 'hand 2 pre-flop closed')
  check('D.7b', stackOf(h2Closed, 'Cal') === 0 && stackOf(h2Closed, 'Dave') === 600 && stackOf(h2Closed, 'Bea') === 1560,
    'all matched Cal’s 280 shove (Dave 600, Bea 1560, Cal all-in 0)')

  // ---- D.8 side pot above the all-in cap, ordered settlement, exact split ----
  await button('Next street').click()
  await botWait(bea, (s) => s.hand?.street === 'flop', 'hand 2 flop')
  await page.getByRole('button', { name: 'Bet 100' }).click()
  await botCommand(bea, { _tag: 'call' })
  await botWait(bea, (s) => s.hand?.nextStreetReady === true, 'flop closed')
  for (const street of ['turn', 'river']) {
    await button('Next street').click()
    await botWait(bea, (s) => s.hand?.street === street, street)
    await page.getByRole('button', { name: /^Check$/ }).click()
    await botCommand(bea, { _tag: 'check' })
    await botWait(bea, (s) => s.hand?.nextStreetReady === true, `${street} closed`)
  }
  await button('Next street').click()
  const showdown2 = await botWait(bea, (s) => s.game.status === 'showdown', 'hand 2 showdown')
  const pots = showdown2.pots.map((p) => `${p.label}=${p.amount}(${p.eligiblePlayerIds.length} eligible)`)
  check('D.8a', showdown2.pots[0]?.amount === 840 && showdown2.pots[1]?.amount === 200 && showdown2.pots[1]?.eligiblePlayerIds.length === 2,
    `pots built: ${pots.join(', ')} — side pot excludes the capped all-in`)
  await page.getByRole('radio', { name: /Cal/ }).check()
  const noTakeAll = (await page.getByRole('button', { name: 'Take All Eligible' }).count()) === 0
  check('D.8b', noTakeAll, 'Take All Eligible absent for Cal (not eligible for the side pot)')
  await button('Award Main Pot').click()
  await button('Confirm Award').click()
  await botWait(bea, (s) => s.pots.length === 1, 'main pot settled')
  await page.getByRole('button', { name: /Split/ }).first().click()
  const splitInputs = page.locator('input[type="number"]')
  await splitInputs.nth(0).fill('100')
  await page.getByText('Remaining: 100').waitFor()
  await splitInputs.nth(1).fill('100')
  await page.getByText('Remaining: 0').waitFor()
  await page.getByRole('button', { name: 'Confirm Split' }).click()
  await page.getByRole('button', { name: 'Yes, Split' }).click()
  const afterH2 = await botWait(bea, (s) => s.game.status === 'between-hands', 'hand 2 settled')
  check('D.8c', stackOf(afterH2, 'Cal') === 840 && stackOf(afterH2, 'Dave') === 600 && stackOf(afterH2, 'Bea') === 1560,
    'main 840 → Cal; side 200 split 100/100 with live Remaining feedback (600/1560/840)')

  // ---- D.9 interrupted vs released ----
  bea.socket.disconnect()
  await page.getByText('Interrupted').waitFor()
  pass('D.9a', 'Bea dropped → amber Interrupted badge, no auto-anything')
  await botConnect(bea, code)
  await botCommand(bea, { _tag: 'claim-seat', seatIndex: 1, profileId: bea.profileId })
  await page.getByText('Interrupted').waitFor({ state: 'hidden' })
  pass('D.9b', 'hint-based reclaim restored Bea’s seat')
  cal.socket.disconnect()
  await sleep(600)
  await button('Manage').click()
  await button('Release Cal').click()
  await button('Confirm Release').click()
  await botWait(bea, (s) => s.players.find((p) => p.name === 'Cal')?.connection === 'released', 'Cal released')
  await button('Next Hand').click()
  const hand3 = await botWait(bea, (s) => s.game.status === 'in-hand', 'hand 3 started')
  const calDealtIn = hand3.hand.commitments.some((c) => c.seatIndex === 2)
  await page.getByText('⏸ Sitting out').waitFor()
  check('D.9c', !calDealtIn && stackOf(hand3, 'Cal') === 840 && hand3.hand.dealerSeat !== 2,
    'released seat DEALT AROUND (Slice 12 fix): no blinds, ⏸ Sitting out badge, 840 chips untouched, dead button skipped')

  // ---- D.10 confirmed fold bundles auto-award; rebuy ----
  await button('Fold').click()
  await page.getByText(/You give up this hand/).waitFor()
  await button('Confirm Fold').click()
  const afterH3 = await botWait(bea, (s) => s.game.status === 'between-hands', 'hand 3 settled by fold')
  check('D.10a', stackOf(afterH3, 'Bea') === 1610 && stackOf(afterH3, 'Dave') === 550,
    'heads-up confirmed fold bundled the uncontested auto-award (Dave 550, Bea 1610)')
  await button('Manage').click()
  await button('Rebuy / Add Chips').click()
  await page.locator('.manage-drawer__form select').selectOption({ label: 'Cal' })
  await button('Review Rebuy').click()
  await page.getByText(/Cal receives 1000 chips for 10\.00 EUR/).waitFor()
  await button('Confirm Rebuy').click()
  const afterRebuy = await botWait(bea, (s) => stackOf(s, 'Cal') === 1840, 'rebuy credited')
  check('D.10b', stackOf(afterRebuy, 'Cal') === 1840, 'rebuy: Cal +1000 chips for 10.00 EUR (stack 1840)')

  // ---- D.11 finish + cash-out ----
  await button('Manage').click()
  await button('Finish Game').click()
  await button('Confirm Finish').click()
  await page.getByText(/Total buy-ins 40\.00 EUR — total cash-out 40\.00 EUR/).waitFor()
  pass('D.11a', 'cash-out conserves: total buy-ins 40.00 EUR (incl. rebuy) == total cash-out 40.00 EUR')
  const daveRow = await page.getByText('Dave', { exact: true }).locator('..').textContent()
  check('D.11b', daveRow.includes('5.50') && daveRow.includes('-4.50'),
    `per-player rows correct (Dave: buy-in 10.00, chips 550, cash-out 5.50, net -4.50)`)
  await page.getByLabel(/transfer amount/i).first().fill('445')
  await button('Finalize Cash-Out').click()
  await page.getByText(/2 transfer\(s\)/).waitFor()
  await button('Confirm Cash-Out').click()
  await page.locator('.cash-out__settled').waitFor()
  const settledText = await page.locator('.cash-out').textContent()
  check('D.11c', settledText.includes('4.45') && settledText.includes('1.60'),
    'edited transfer (450→445) finalized; read-only Settled shows 4.45 + 1.60 EUR payments')

  // ---- D.12 restart: history + stats from SQLite ----
  await stopServer()
  report('server KILLED (SIGTERM) — restarting over the same database…')
  await startServer()
  await page.goto(`${APP}/`)
  await page.locator('.history-list__code', { hasText: `#${code}` }).waitFor()
  await page.getByText('3 hands').waitFor()
  await page.getByText('Settled').waitFor()
  await page.getByRole('button', { name: 'Bea', exact: true }).click()
  await page.getByText('Games played').waitFor()
  const statsText = await page.locator('[aria-label="Player stats"]').textContent()
  check('D.12', statsText.includes('+6.10'),
    `after restart: Past Games shows #${code} · 3 hands · Settled; Bea stats net +6.10 from SQLite`)

  // ---- D.13 console hygiene ----
  check('D.13', hardErrors.length === 0,
    `zero hard console/page errors (${netNoise.length} transient network-noise lines during the deliberate restart are excluded and listed below)`)
  if (netNoise.length > 0) report('  network-noise during restart: ' + netNoise.slice(0, 5).join(' | '))

  report('')
  report(`FINAL: PASS — full night played end-to-end. NDJSON log: ${path.relative(appDir, logDir)}/ (summarize with pnpm logs:report)`)
  report('Browser and servers stay up for inspection — stop the pcc-headed task to clean up.')
}

main().catch((error) => {
  report('')
  report(`FINAL: FAIL — ${error.message}`)
  report(error.stack ?? '')
  report('Browser and servers stay up for inspection — stop the pcc-headed task to clean up.')
})
