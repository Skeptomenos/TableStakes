// Investigation entry point (ARCHITECTURE.md Observability And Logging):
// summarize an NDJSON log file so a maintenance session can see at a
// glance what went wrong during a game night.
//
// Usage: pnpm logs:report [path/to/pcc-YYYY-MM-DD.ndjson]
// Defaults to the newest file under data/logs/.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const appDir = path.resolve(new URL('..', import.meta.url).pathname)

function resolveFile() {
  const given = process.argv[2]
  if (given) return path.resolve(given)
  const dir = process.env.PCC_LOG_DIR ?? path.join(appDir, 'data', 'logs')
  const files = readdirSync(dir)
    .filter((name) => /^pcc-\d{4}-\d{2}-\d{2}\.ndjson$/.test(name))
    .sort()
  if (files.length === 0) {
    console.error(`no log files found in ${dir}`)
    process.exit(1)
  }
  return path.join(dir, files.at(-1))
}

const file = resolveFile()
const lines = []
for (const raw of readFileSync(file, 'utf8').split('\n')) {
  if (!raw.trim()) continue
  try {
    lines.push(JSON.parse(raw))
  } catch {
    // skip corrupt lines; report their count
    lines.push(null)
  }
}
const corrupt = lines.filter((l) => l === null).length
const rows = lines.filter((l) => l !== null)

const count = (items) => {
  const map = new Map()
  for (const item of items) map.set(item, (map.get(item) ?? 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

console.log(`# Log report: ${path.basename(file)}`)
console.log(`${rows.length} lines${corrupt ? ` (${corrupt} corrupt skipped)` : ''}`)
if (rows.length > 0) {
  console.log(`span: ${rows[0].ts} .. ${rows.at(-1).ts}`)
}

console.log('\n## Lines by level')
for (const [level, n] of count(rows.map((r) => r.level))) {
  console.log(`  ${level.padEnd(5)} ${n}`)
}

console.log('\n## Warnings and errors by event')
const bad = rows.filter((r) => r.level === 'error' || r.level === 'warn')
for (const [event, n] of count(bad.map((r) => r.event))) {
  console.log(`  ${event.padEnd(28)} ${n}`)
}
if (bad.length === 0) console.log('  none')

console.log('\n## Disconnect reasons')
const reasons = rows
  .filter((r) => r.event === 'socket.disconnect')
  .map((r) => String(r.reason))
  .concat(
    rows
      .filter((r) => r.event === 'client.log' && r.origin === 'socket.disconnect')
      .map((r) => String(r.msg)),
  )
for (const [reason, n] of count(reasons)) {
  console.log(`  ${reason.padEnd(32)} ${n}`)
}
if (reasons.length === 0) console.log('  none')

console.log('\n## Pipeline defects')
const defects = rows.filter((r) => r.event === 'command.defect')
for (const defect of defects) {
  console.log(`  [${defect.ts}] ${defect.msg}`)
  const cause = String(defect.cause ?? '')
  for (const line of cause.split('\n').slice(0, 6)) {
    console.log(`    ${line}`)
  }
}
if (defects.length === 0) console.log('  none')

console.log('\n## Slowest commands')
const slow = rows
  .filter((r) => r.event === 'command.accepted' && typeof r.durMs === 'number')
  .sort((a, b) => b.durMs - a.durMs)
  .slice(0, 5)
for (const cmd of slow) {
  console.log(`  ${String(cmd.cmd).padEnd(24)} ${cmd.durMs}ms  vtx=${cmd.vtx}`)
}
if (slow.length === 0) console.log('  none')

console.log('\n## Client-shipped errors')
const clientErrors = rows.filter(
  (r) => r.event === 'client.log' && r.level === 'error',
)
for (const entry of clientErrors.slice(0, 10)) {
  console.log(`  [${entry.ts}] ${entry.origin}: ${entry.msg} (sid=${entry.sid})`)
}
if (clientErrors.length === 0) console.log('  none')
