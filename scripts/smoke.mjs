// Built-artifact smoke: boot the production server exactly as `pnpm start`
// does, poll health, request a game route, and clean up. Fails loudly with
// the failing URL/status so a future agent can act on the message alone.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const appDir = path.resolve(new URL('..', import.meta.url).pathname)
const serverEntry = path.join(appDir, 'dist', 'server.mjs')
const port = 3000 + Math.floor(Math.random() * 2000)
const base = `http://127.0.0.1:${port}`

function fail(message) {
  console.error(`SMOKE FAIL: ${message}`)
  process.exitCode = 1
}

if (!existsSync(serverEntry)) {
  fail(`built server missing at ${serverEntry} — run \`pnpm build\` first`)
  process.exit(1)
}

const child = spawn('node', [serverEntry], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
child.stdout.on('data', (d) => (serverOutput += d))
child.stderr.on('data', (d) => (serverOutput += d))

const cleanup = () => {
  if (!child.killed) child.kill('SIGTERM')
}
process.on('exit', cleanup)

try {
  // Poll /healthz until the server answers or we give up.
  let healthy = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`${base}/healthz`)
      if (res.ok) {
        const body = await res.json()
        if (body.ok !== true) {
          fail(`/healthz responded but body was ${JSON.stringify(body)}`)
          process.exit(1)
        }
        healthy = true
        break
      }
    } catch {
      // server not up yet
    }
    await sleep(100)
  }
  if (!healthy) {
    fail(`server never became healthy at ${base}/healthz\nserver output:\n${serverOutput}`)
    process.exit(1)
  }
  console.log(`smoke: ${base}/healthz ok`)

  // A game URL must serve the client shell HTML (SPA fallback).
  const gameRes = await fetch(`${base}/g/48317`)
  const html = await gameRes.text()
  if (gameRes.status !== 200) {
    fail(`/g/48317 returned status ${gameRes.status}: ${html.slice(0, 200)}`)
    process.exit(1)
  }
  if (!html.includes('<div id="root">')) {
    fail(`/g/48317 did not serve the client shell. Body: ${html.slice(0, 200)}`)
    process.exit(1)
  }
  console.log('smoke: /g/48317 serves client shell')
  console.log('SMOKE PASS')
} finally {
  cleanup()
}
