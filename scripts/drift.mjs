// Docs drift check: cross-check high-value literals between project docs,
// package metadata, and shared route constants. Grep-level only — semantic
// doc review belongs to the independent verifier.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const appDir = path.resolve(new URL('..', import.meta.url).pathname)
const failures = []

function read(rel) {
  return readFileSync(path.join(appDir, rel), 'utf8')
}

// 1. Required docs exist.
for (const doc of [
  'SPEC.md',
  'ARCHITECTURE.md',
  'TESTING.md',
  'DESIGN.md',
  'README.md',
  'AGENTS.md',
]) {
  if (!existsSync(path.join(appDir, doc))) {
    failures.push(`required doc missing: ${doc}`)
  }
}

// 2. Route literals in code match the documented URL shape.
const routes = read('src/shared/routes.ts')
const spec = read('SPEC.md')
if (!routes.includes("GAME_ROUTE_PREFIX = '/g/'")) {
  failures.push("src/shared/routes.ts GAME_ROUTE_PREFIX must be '/g/' per SPEC.md")
}
if (!spec.includes('/g/<five-digit-code>')) {
  failures.push('SPEC.md no longer documents the /g/<five-digit-code> URL shape')
}
if (!routes.includes("HEALTH_ROUTE = '/healthz'")) {
  failures.push("src/shared/routes.ts HEALTH_ROUTE must be '/healthz'")
}

// 3. package.json exposes every script the implementation plan requires.
const pkg = JSON.parse(read('package.json'))
const requiredScripts = [
  'dev',
  'build',
  'start',
  'typecheck',
  'lint',
  'test',
  'test:unit',
  'test:integration',
  'test:realtime',
  'smoke',
  'drift',
  'validate',
]
for (const script of requiredScripts) {
  if (!pkg.scripts?.[script]) {
    failures.push(`package.json missing required script: ${script}`)
  }
}

// 4. README documents the validation gate and dev startup.
const readme = read('README.md')
for (const literal of ['pnpm validate', 'pnpm dev', 'pnpm install', 'pnpm logs:report']) {
  if (!readme.includes(literal)) {
    failures.push(`README.md must document \`${literal}\``)
  }
}

// 5. Every log event documented in the ARCHITECTURE observability
// vocabulary exists in the source: logs are a machine-readable interface
// and the docs must not rot away from the code.
function walkSource(dir) {
  let out = ''
  for (const entry of readdirSync(path.join(appDir, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out += walkSource(rel)
    else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !entry.name.includes('.test.')) {
      out += read(rel)
    }
  }
  return out
}

const architecture = read('ARCHITECTURE.md')
const vocabularyRows = architecture.match(/^\| `([a-z_.]+)` \|/gm) ?? []
const documentedEvents = vocabularyRows.map((row) => row.match(/`([a-z_.]+)`/)[1])
if (documentedEvents.length === 0) {
  failures.push('ARCHITECTURE.md observability vocabulary table not found')
}
const source = walkSource('src') + walkSource('scripts')
for (const event of documentedEvents) {
  if (!source.includes(`'${event}'`)) {
    failures.push(`documented log event \`${event}\` not found in src/`)
  }
}

// 6. The logs:report entry point exists.
if (!pkg.scripts?.['logs:report']) {
  failures.push('package.json missing required script: logs:report')
}

// 7. Every command in the GameCommand union is dispatched by the game
// reducer. A schema-only command silently rejects at runtime with
// "command not implemented yet" — exactly the drift this catches.
const commandSchema = read('src/shared/schema/commands.ts')
const commandTags = [
  ...commandSchema.matchAll(/Schema\.TaggedStruct\('([a-z-]+)'/g),
].map((m) => m[1])
if (commandTags.length === 0) {
  failures.push('no TaggedStruct commands found in src/shared/schema/commands.ts')
}
const reducer = read('src/domain/reducers/game-reducer.ts')
for (const tag of commandTags) {
  if (!reducer.includes(`case '${tag}':`)) {
    failures.push(
      `command \`${tag}\` is in the GameCommand union but not dispatched in game-reducer.ts`,
    )
  }
}

// 8. The game-status vocabulary in code and the ARCHITECTURE state machine
// stay in sync, both directions (a dead literal invites drift; an
// undocumented one hides behavior).
const snapshotSchema = read('src/shared/schema/snapshot.ts')
const statusBlock = snapshotSchema.match(
  /GameStatus = Schema\.Literal\(([\s\S]*?)\)/,
)
const codeStatuses = statusBlock
  ? [...statusBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
  : []
const machineSection = architecture.match(
  /## Game State Machine[\s\S]*?Street states:/,
)
const docStatuses = machineSection
  ? [...machineSection[0].matchAll(/^- `([a-z-]+)`\.$/gm)].map((m) => m[1])
  : []
if (codeStatuses.length === 0 || docStatuses.length === 0) {
  failures.push('could not parse GameStatus literals or the ARCHITECTURE state machine')
}
for (const status of codeStatuses) {
  if (!docStatuses.includes(status)) {
    failures.push(`GameStatus \`${status}\` is in code but not in ARCHITECTURE.md`)
  }
}
for (const status of docStatuses) {
  if (!codeStatuses.includes(status)) {
    failures.push(`GameStatus \`${status}\` is documented but not in code`)
  }
}

if (failures.length > 0) {
  console.error('DRIFT FAIL:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('DRIFT PASS')
