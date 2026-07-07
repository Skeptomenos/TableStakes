# Contributing to TableStakes

TableStakes (the app in `apps/poker-chip-counter`) is a local-first web app for phone-based chip accounting at home poker games: one Node.js server on the host laptop, phone clients over the LAN, no accounts, no cloud. The user-facing story is in [README.md](README.md); this page is the developer's map.

## Stack

TypeScript end to end: Node 22+, Express 5 + Socket.IO on the server, React 19 + Vite on the client, SQLite (better-sqlite3) for persistence, Effect for schema validation and the command pipeline, Vitest + Playwright for tests. The domain layer (`src/domain`) is pure and framework-free — every chip movement is a reducer over an immutable snapshot, and chip conservation is asserted by tests on every transition.

```
src/
  shared/   schemas (commands, events, snapshot), chip/money helpers, routes
  domain/   pure reducers: hands, betting, side pots, settlement, cash-out, undo
  server/   command pipeline, Socket.IO sessions, SQLite persistence, logging
  client/   React phone UI: join, live table, action panel, settlement, cash-out
tests/
  integration/  real SQLite temp files, service-level pipeline tests
  e2e/          Playwright phone-portrait browser flows
```

Key documents:

- [SPEC.md](SPEC.md) — product behavior contract and acceptance criteria
- [ARCHITECTURE.md](ARCHITECTURE.md) — module boundaries, command pipeline, persistence, realtime, observability
- [DESIGN.md](DESIGN.md) — the "Deep Stack Logic" visual contract for every screen
- [TESTING.md](TESTING.md) — test layers and the browser-E2E policy
- [_planning/](_planning/) — living implementation plans and verification records (kept out of the public split)

## Development setup

pnpm is provided through corepack (ships with Node):

```bash
corepack enable pnpm
cd apps/poker-chip-counter    # repo root when working from the TableStakes split
pnpm install
pnpm exec playwright install chromium   # one-time, for browser E2E
```

Common commands:

- `pnpm dev` — run the Node server and Vite client together with hot reload.
- `pnpm build && pnpm start` — build and boot the production server (default port 8080, LAN-reachable). `./start.sh` wraps install+build+start for end users.
- `pnpm validate` — **the single validation gate**: build, typecheck, lint, unit/integration/realtime tests, built-artifact smoke, Playwright browser E2E, and docs drift checks. Green `pnpm validate` is required before any implementation claim — no exceptions, no partial runs.
- `pnpm logs:report [file]` — summarize a session's NDJSON log (levels, warnings, disconnect reasons, slow commands, client-shipped errors).

## How changes land

1. **Tests first.** For known behavior, write the failing test before the implementation (see TESTING.md for which layer). Chip math changes without a conservation assertion will not pass review.
2. **The gate is indivisible.** `pnpm validate` runs everything; a change is done when the whole gate is green, not when its own test passes.
3. **Living plans.** Multi-step work is governed by a plan in `_planning/plans/` (vertical slices, probes, evidence). Completed checkboxes carry the command + observed result.
4. **Independent verification.** Before a release-sized change merges, a fresh-context reviewer re-derives the plan's claims and re-runs the gate. Zero disputed claims is the bar the MVP shipped with.

## Debugging a game night

Runtime logs are structured NDJSON under `data/logs/` (daily files, bounded retention; level via `PCC_LOG_LEVEL`). Start there for any runtime issue: `pnpm logs:report`, then correlate `vtx` ids in log lines with the SQLite `events`/`snapshots` tables for full state forensics. Phones ship their warnings/errors to the host log too (`client.log` lines), so one file holds the whole night. Every incident diagnosed from logs must leave a regression test behind.

## Useful environment variables

| Variable | Effect |
|---|---|
| `PORT` | Server port (default 8080) |
| `PCC_DB_PATH` | SQLite database location (default `data/poker-chip-counter.db`) |
| `PCC_LOG_DIR` | Log directory (default `data/logs`) |
| `PCC_LOG_LEVEL` | `error` / `warn` / `info` (default) / `debug` |

## Repository layout note

Development happens in the [`Skeptomenos/ai-dev`](https://github.com/Skeptomenos/ai-dev) monorepo under `apps/poker-chip-counter`; every merge to `main` publishes this directory to the public [`Skeptomenos/TableStakes`](https://github.com/Skeptomenos/TableStakes) repo (with `_planning/` stripped). PRs are welcome against either — monorepo PRs land fastest since that is where CI and review run.
