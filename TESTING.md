# Poker Chip Counter Testing Strategy

Status: Draft
Last updated: 2026-07-02

## Goals

Testing is part of the MVP architecture. The app manages real chip and money accounting, so correctness must be proven at the domain, persistence, realtime, and browser-flow layers before a feature is treated as done.

The test suite should make these failures hard to ship:

- Chips disappearing or duplicating.
- Incorrect side-pot eligibility.
- Wrong turn advancement.
- Broken reconnect or seat locking.
- Settlement rounding errors.
- UI flows that require too much live-table tapping.
- Persistence bugs after server restart.

## Tooling

Use the TypeScript stack unless implementation discovery finds a stronger repo convention:

- `vitest` for unit and integration tests.
- Real SQLite databases in temporary files for persistence tests.
- Socket.IO client/server tests for realtime behavior.
- Browser automation for browser E2E and mobile viewport validation. Any capable harness is acceptable: an agent-bundled browser plugin, chrome-devtools MCP, the Claude Code browser extension, or a committed Playwright harness.
- TypeScript strict mode and linting as part of the same validation gate.

Do not mock internal repositories, services, reducers, or command handlers. Prefer real implementations with temporary data. Mock only time, id generation, randomness, and external network boundaries when needed.

## Test Organization

Recommended layout:

```text
src/
  domain/
    side-pots.ts
    side-pots.test.ts
    turn-order.ts
    turn-order.test.ts
    settlement.ts
    settlement.test.ts
  server/
    game-service.ts
    game-service.test.ts
tests/
  integration/
    command-pipeline.test.ts
    persistence-restore.test.ts
    realtime-socket.test.ts
  e2e/
    console-create.spec.ts
    join-buy-in.spec.ts
    normal-hand.spec.ts
    side-pot-settlement.spec.ts
    reconnect-recovery.spec.ts
    cash-out.spec.ts
```

Unit tests stay close to pure source files. Integration and E2E tests live under top-level `tests/`.

## Unit Tests

Unit tests cover pure domain logic with deterministic inputs and no database or network:

- Chip conservation for every reducer transition.
- Blind posting and first actor selection.
- Heads-up blind posting and action order with 2 players.
- Dead-button advancement past busted, empty, or sitting-out seats.
- Short-stack blind posting as all-in for less.
- Turn order after fold, check, call, bet, raise, and all-in.
- Street closure detection and `Next street` readiness.
- Raise-rule minimums for `Any raise`, `Double`, and `Standard NLHE`.
- No betting reopen after an all-in below the rule minimum.
- Soft-mode warning vs strict-mode blocking.
- Exact numeric entry below suggested minimum in soft mode.
- Side-pot construction with separate contributor and eligible-winner sets.
- Folded-player contributions remaining in pots.
- Multiple all-in thresholds.
- Uncontested final-fold auto-award transaction.
- Split allocation and remaining-unallocated calculation.
- Even-split allocation engine (ADR 0003): N-way division, deterministic odd-chip distribution from the earliest seat after the dealer, zero-sum adjustments never breaking full allocation.
- Needs-rebuy gating (ADR 0003): prompt card shown only to the needs-rebuy hero; `Next Hand` disabled with a reason while fewer than two seated players have chips.
- Transaction-level undo grouping.
- Cash-out rounding and minimized transfers.

Unit tests should use explicit fixtures rather than random table state. Property-style tests can be added later for chip conservation across generated action sequences, but deterministic examples come first.

## Integration Tests

Integration tests run real services against a real temporary SQLite database:

- Command decode, validation, reduction, persistence, snapshot update, and ack.
- Event append inside a transaction before broadcast.
- Active-game restore from event log and optional snapshot.
- Finished-game archival and stats source data.
- Five-digit code collision regeneration.
- Host-owned player profile creation, rename, and game-seat linking.
- Rebuy timing and active-hand eligibility protection.
- Money rules (ADR 0002): first buy-in must equal the table default; rebuy amounts capped at the default; profile-optional game creation records its origin.
- Strict-mode, raise-rule, and blind changes audited and applied from the next hand.
- Cancel-hand full refund including blinds without button advance.
- Game reset to setup with stacks equal to purchased chips.
- Zero-sum correction enforcement.
- Visible transaction persistence for undo.

Integration tests should inject deterministic clock and id generation. SQLite should use a temporary file, not an in-memory fake, so restart and restore behavior can be tested by closing and reopening the database.

## Realtime Tests

Realtime tests use real Socket.IO server and client instances in-process:

- Two or more clients join the same game room.
- The active claimed seat can submit normal poker actions.
- Non-active seats cannot submit normal poker actions.
- Non-active connected players can submit audited table actions.
- Active connected seats are locked from other clients.
- Socket disconnect marks the seat interrupted without auto-fold.
- Reconnect with a valid local hint can return to the same interrupted seat.
- A stale or conflicting local hint cannot claim an actively connected seat.
- Full snapshot sync after reconnect covers missed events.

These tests are distinct from browser E2E: they verify transport behavior without browser rendering.

## E2E Tests

Browser E2E covers user-visible workflows in desktop host and phone portrait contexts. The harness is tool-agnostic: an agent-bundled browser plugin, chrome-devtools MCP, the Claude Code browser extension, or a committed Playwright harness are all acceptable. The earlier Playwright prohibition was lifted on 2026-07-02.

Browser E2E should drive the running app and verify visible behavior from the user's point of view. Tests should be documented as repeatable scenarios even when the execution harness is agent-driven rather than a committed browser-test package. If a committed harness is used, wire its smoke suite into `pnpm validate`.

Minimum MVP E2E flows (ADR 0002 surface split):

- Console (`/console`) creates a table with `10 EUR = 1000 chips`, blinds, and strict mode default off; sees QR/full URL/five-digit code/LAN hints permanently.
- Player opens `/g/<code>`, creates or selects a profile, claims a seat, and confirms the fixed default buy-in.
- Second device: lands on the player landing (`/`) while a table exists, joins it from the active-tables list, and sees the first player's taken seat.
- No player surface offers table creation; a first buy-in differing from the default and a rebuy above the default are rejected.
- With two players bought in, the first dealer is picked and the first hand starts (console-primary, any client allowed).
- Normal hand: blinds post, players check/call/raise/fold, street advances, pot is awarded, next hand advances dealer/blinds.
- Soft-mode below-minimum exact raise with the `Double` or `Standard NLHE` rule active: warning appears, commit is allowed.
- Strict-mode below-minimum exact raise: commit is blocked.
- Short-stack call displays `Call All-in <stack>` in the call slot and creates the correct side pot.
- Side-pot settlement proceeds main pot, side pot 1, side pot 2, with exact split allocation feedback.
- Reconnect: reload or disconnect a phone client, return through `/g/<code>`, and recover the same seat without ghost players.
- End-of-night cash-out shows buy-ins, rebuys, final chips, net results, and editable minimized transfers.

Browser E2E should run phone portrait viewports for live gameplay. Landscape should have a focused test for the rotate prompt.

## Visual And Design Checks

E2E visual checks should assert structure and behavior first, not pixel-perfect styling. `DESIGN.md` is the visual contract for MVP implementation.

Pixel-level visual regression snapshots are explicitly DEFERRED past MVP (Slice 12 decision): the committed Playwright specs assert visible structure and behavior for the console, player landing, join/seat selection, buy-in confirmation, live table, settlement, and cash-out, and per-slice agent-driven visual dogfood against `DESIGN.md` covered the styling. Screenshot baselines would be brittle while the design still moves; revisit once the UI stabilizes post-MVP.

Visual checks should verify that core controls fit in a phone portrait viewport without live-hand scrolling.

## Observability Tests

Logging is load-bearing for maintenance (see `ARCHITECTURE.md` Observability
And Logging), so it is tested like any other subsystem:

- Unit: NDJSON line shape, level filtering, error serialization, daily file
  naming, retention sweep, session-id truncation, and sink-failure
  resilience (a failing sink must never throw into gameplay code).
- Integration: accepted, rejected, and defect command paths emit their
  documented events with correct fields; socket disconnects log the
  Socket.IO disconnect reason; `/api/client-logs` accepts capped batches
  and rejects oversized ones.
- Drift: every event name documented in the ARCHITECTURE event vocabulary
  exists in the source.

Incident rule: any bug diagnosed from runtime logs gets a regression test
at the lowest useful layer before the fix lands, same as every other bug.

## Validation Gate

Once the runtime project exists, define one required command:

```text
pnpm validate
```

The validation gate should run:

1. Type check.
2. Lint.
3. Unit tests.
4. Integration tests.
5. Realtime tests.
6. Browser smoke E2E.
7. Build.

Longer E2E and visual suites may have separate commands during development, but `pnpm validate` is the minimum before claiming implementation work complete.

## TDD Expectations

For domain and persistence work, write the failing test first whenever the behavior is known from `SPEC.md`.

Every bug fix should add or update a regression test at the lowest useful layer:

- Pure math or state bug: unit test.
- Persistence or restore bug: integration test.
- Socket/session bug: realtime test.
- User flow bug: browser E2E.

Do not rely on manual testing to prove accounting correctness.
