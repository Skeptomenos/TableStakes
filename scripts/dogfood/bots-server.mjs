// Dogfood bot driver: scripted socket players steered over a local HTTP
// control API (port 4312) so an agent can play multi-phone scenarios
// against the built artifact from one real Chrome phone. Dev/verification
// tooling only — not part of the app. Run via the `pcc-bots` launch config
// (the CC sandbox blocks listen(); see the FINAL verification doc Part 0).
import { createServer } from 'node:http'

import { io } from 'socket.io-client'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:4310'
const bots = new Map()

async function api(path, body) {
  const res = await fetch(
    `${APP}${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  )
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`)
  return res.json()
}

function connectBot(name, code, sessionId) {
  const socket = io(APP, {
    auth: { gameCode: code, sessionId },
    transports: ['websocket'],
  })
  const bot = { name, code, sessionId, socket, snapshot: null, joinError: null }
  socket.on('snapshot', ({ snapshot }) => {
    bot.snapshot = snapshot
  })
  socket.on('join-error', ({ reason }) => {
    bot.joinError = reason
  })
  bots.set(name, bot)
  return new Promise((resolve) => {
    socket.on('connect', () => resolve(bot))
    socket.on('connect_error', () => resolve(bot))
    setTimeout(() => resolve(bot), 3000)
  })
}

// The server sends the initial snapshot right after 'connect', but as a
// separate message — connectBot's promise can resolve slightly before it
// arrives. /join needs the table's default buy-in settings before it can
// send record-buy-in, so wait for the snapshot explicitly instead of
// racing it.
function waitForSnapshot(bot, deadline = Date.now() + 3000) {
  if (bot.snapshot || Date.now() > deadline) return Promise.resolve(bot.snapshot)
  return new Promise((resolve) => {
    setTimeout(() => resolve(waitForSnapshot(bot, deadline)), 25)
  })
}

function sendCommand(bot, command) {
  return new Promise((resolve) => {
    const id = `bot-${bot.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const onAck = (p) => {
      if (p.id !== id) return
      cleanup()
      resolve({ status: 'ack' })
    }
    const onRej = (p) => {
      if (p.id !== id) return
      cleanup()
      resolve({ status: 'rejected', reason: p.reason })
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
      resolve({ status: 'timeout' })
    }, 5000)
  })
}

function summarize(bot) {
  const s = bot.snapshot
  if (!s) return { connected: bot.socket.connected, snapshot: null, joinError: bot.joinError }
  return {
    connected: bot.socket.connected,
    status: s.game.status,
    street: s.hand?.street ?? null,
    activeSeat: s.hand?.activeSeat ?? null,
    currentBet: s.hand?.currentBet ?? null,
    minRaiseTo: s.hand?.minRaiseTo ?? null,
    nextStreetReady: s.hand?.nextStreetReady ?? null,
    dealerSeat: s.hand?.dealerSeat ?? s.game.dealerSeat,
    settings: {
      strictMode: s.game.settings.strictMode,
      raiseRule: s.game.settings.raiseRule,
      pending: s.game.pendingSettings
        ? {
            strictMode: s.game.pendingSettings.strictMode,
            raiseRule: s.game.pendingSettings.raiseRule,
          }
        : null,
    },
    pots: s.pots.map((p) => ({ id: p.id, label: p.label, amount: p.amount })),
    players: s.players.map((p) => ({
      seat: p.seatIndex,
      id: p.id,
      name: p.name,
      stack: p.stack,
      hand: p.handStatus,
      conn: p.connection,
      sitOut: p.sitOutNextHand,
    })),
  }
}

async function route(path, input, params) {
  switch (path) {
    case '/health':
      return { ok: true, bots: [...bots.keys()] }
    case '/join': {
      const { name, code, seat } = input
      const profile = await api('/api/profiles', { name })
      const sessionId = `bot-sess-${name}-${Math.random().toString(36).slice(2, 10)}`
      const bot = await connectBot(name, code, sessionId)
      bot.profileId = profile.profileId
      const claim = await sendCommand(bot, {
        _tag: 'claim-seat',
        seatIndex: seat,
        profileId: profile.profileId,
      })
      // ADR 0002: claiming a seat no longer credits chips by itself — the
      // choreography flip moved the auto-buy-in out of setup entirely.
      // Bots must explicitly confirm the buy-in (exact table default) the
      // same way a phone's BuyInConfirm does, or every bot-driven dogfood
      // scenario would seat players with zero chips and never deal them
      // in. Skipped when reclaiming a seat that already has chips, same
      // as the phone flow.
      let buyIn = null
      if (claim.status === 'ack') {
        const snapshot = await waitForSnapshot(bot)
        const me = snapshot?.players.find((p) => p.seatIndex === seat)
        if (me && me.stack === 0) {
          const { defaultBuyInCents, defaultStack, currency } = snapshot.game.settings
          buyIn = await sendCommand(bot, {
            _tag: 'record-buy-in',
            playerId: me.id,
            money: { currency, cents: defaultBuyInCents },
            chips: defaultStack,
          })
        }
      }
      return {
        profileId: profile.profileId,
        sessionId,
        claim,
        buyIn,
        joinError: bot.joinError,
      }
    }
    case '/cmd': {
      const bot = bots.get(input.name)
      if (!bot) return { error: 'no such bot' }
      return await sendCommand(bot, input.command)
    }
    case '/drop': {
      const bot = bots.get(input.name)
      if (!bot) return { error: 'no such bot' }
      bot.socket.disconnect()
      return { ok: true }
    }
    case '/reconnect': {
      const old = bots.get(input.name)
      if (!old) return { error: 'no such bot' }
      const bot = await connectBot(old.name, old.code, old.sessionId)
      bot.profileId = old.profileId
      if (input.seat !== undefined) {
        const claim = await sendCommand(bot, {
          _tag: 'claim-seat',
          seatIndex: input.seat,
          profileId: old.profileId,
        })
        return { claim }
      }
      return { ok: true }
    }
    case '/state': {
      const bot = bots.get(params.get('name'))
      if (!bot) return { error: 'no such bot' }
      return summarize(bot)
    }
    default:
      return { error: `unknown route ${path}` }
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') {
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  let body = ''
  for await (const chunk of req) body += chunk
  let input = {}
  try {
    input = body ? JSON.parse(body) : {}
  } catch {
    input = {}
  }
  try {
    const out = await route(url.pathname, input, url.searchParams)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(out ?? { ok: true }))
  } catch (error) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: String((error && error.message) || error) }))
  }
})

server.listen(4312, '127.0.0.1', () => {
  console.log('bot control listening on http://127.0.0.1:4312')
})
