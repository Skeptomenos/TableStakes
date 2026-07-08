# Poker Chip Counter Architecture

Status: Draft
Last updated: 2026-07-08 (console/player surface separation, ADR 0002)

## Architecture Goals

- Run locally on a host laptop and serve phones over the LAN.
- Keep one authoritative server-side game state.
- Preserve every accepted chip-moving action durably before broadcasting it.
- Make reconnect and restart recovery normal, not exceptional.
- Keep the implementation small enough for an MVP while isolating poker accounting complexity.
- Use Effect where it improves correctness, typed errors, and testability without replacing the whole stack.

## Initial Stack

- TypeScript.
- Node.js server.
- Vite frontend.
- React frontend unless implementation discovery finds a stronger existing repo convention.
- Socket.IO for realtime phone/host sync.
- SQLite for local durable storage.
- Effect for schemas, typed command pipelines, dependency services, and domain errors.
- Vitest for unit, integration, and realtime tests.
- Browser automation for browser E2E tests, agent-driven or a committed Playwright harness.

## Runtime Topology

```text
Player browsers (/g/<code>, /) ─┐
Console browser (/console)     ─┼─ HTTP + Socket.IO ─ Node server ─ SQLite database
Player browsers (/g/<code>)    ─┘
```

Surfaces are separated by route, not by device (ADR 0002): any browser can
open any route; the console is normally the host laptop and the player
routes are normally phones.

The Node server owns canonical state. Clients render snapshots and submit commands. They do not independently mutate chip balances.

## Application Boundaries

Suggested package/module layout:

```text
src/
  shared/
    schema/
    types/
    money.ts
    chips.ts
  domain/
    commands/
    reducers/
    state/
    errors.ts
    side-pots.ts
    settlement.ts
    turn-order.ts
  server/
    app.ts
    http.ts
    socket.ts
    game-service.ts
    persistence/
    profile-service.ts
    restore.ts
  client/
    app/
    routes/
    components/
    state/
    socket-client.ts
    views/
tests/
```

Boundary rules:

- `shared` contains serializable schemas and tiny pure helpers.
- `domain` is framework-free and owns game rules, reducers, and command validation.
- `server` owns transport, persistence, profile storage, and Effect service wiring.
- `client` owns rendering, local socket connection state, and optimistic UI only where safe.

## Effect Usage

Use Effect incrementally.

Good MVP uses:

- `effect/Schema` for command payloads, event payloads, snapshots, and persisted JSON.
- Typed domain errors such as `NotActivePlayer`, `SeatAlreadyClaimed`, `InsufficientStack`, `PotAllocationMismatch`, and `StrictRuleViolation`.
- `Effect` pipelines for command handling: decode, load state, validate, reduce, persist, publish.
- Services/layers for SQLite, clock/id generation, game-code generation, and broadcaster.
- Test dependency injection for deterministic ids, time, and persistence.

Avoid in the MVP:

- Replacing Socket.IO with Effect Platform WebSocket abstractions.
- Forcing the React UI into an Effect-first architecture.
- Building a deep service graph before domain code proves it needs one.

Rationale:

- Effect's official docs frame Effect programs as typed descriptions executed by a runtime, with explicit success, error, and requirement types. That maps well to game commands that can fail for known reasons.
- `effect/Schema` provides runtime validation and transformation for TypeScript data at app boundaries.
- Socket.IO remains the realtime transport because its current docs explicitly cover automatic reconnection, packet buffering, rooms, acknowledgments, and connection state recovery.

## Command Pipeline

All gameplay changes enter through commands.

```text
Socket command
  -> decode with Schema
  -> authenticate connection/session context
  -> load game state
  -> validate command against state
  -> reduce command into domain events
  -> persist events in SQLite transaction
  -> update in-memory state
  -> broadcast snapshot and audit entry
  -> acknowledge command
```

Clients should not consider a command committed until the server acknowledges it.

## Domain Model

Core records:

- `Game`: id, five-digit code, status, settings, creator profile id (optional — console-created games record console origin instead, ADR 0002), created/updated timestamps.
- `GameSettings`: currency, default buy-in cents, default stack, small blind, big blind, strict mode, raise rule, amount step setting.
- `PlayerProfile`: host-owned reusable local profile.
- `GamePlayer`: profile link, seat index, stack, status, connection state, buy-ins, sit-out preference.
- `Connection`: socket/session metadata, claimed player, last seen time.
- `Hand`: hand number, dealer seat, street, active player, current bet, min raise suggestion, player commitments.
- `Pot`: label, amount, eligible player ids, source all-in threshold.
- `BuyIn`: money amount in cents, chips added, reason, timestamp.
- `Event`: append-only accepted change.
- `VisibleTransaction`: user-visible action group for undo.
- `CashSettlement`: end-of-night accounting and payment transfers.

## Events

Events are append-only and serializable.

Initial event families:

- Game lifecycle: `game-created`, `game-configured`, `game-reset`, `game-finished`.
- Profiles/seats: `profile-created`, `seat-claimed`, `seat-released`, `seat-interrupted`, `seat-reconnected`.
- Setup: `dealer-set`, `blinds-updated`, `strict-mode-updated`, `raise-rule-updated`, `amount-step-updated`. (Seat reorder stays out of MVP per SPEC.md optional row-level setup, so there is no `players-reordered` event — Slice 12.)
- Hand lifecycle: `hand-started`, `blind-posted`, `street-advanced`, `hand-cancelled`, `hand-settled`.
- Player actions: `folded`, `checked`, `called`, `bet`, `raised`, `all-in`.
- Pots: `pot-created`, `pot-awarded`, `pot-split`, `uncalled-bet-returned` (Decision Log 2026-07-02: the uncalled portion of a bet returns to the bettor and stays auditable — at showdown entry and, since Slice 10, on uncontested wins).
- Recovery: `undo-committed`, `correction-committed`, `folded-player-restored`, `active-player-set` (named correction tools, Slice 10).
- Sit-out: `sat-out`, `returned-from-sit-out` (Slice 10).
- Money: `buy-in-recorded`, `rebuy-recorded`, `cash-out-finalized`. (ADR 0002: a first buy-in must equal the table default and is triggered by the player's explicit confirmation after claiming a seat; rebuys are capped at the default. The domain rejects violations.)

Each event should include:

- Event id.
- Game id.
- Hand id when applicable.
- Visible transaction id.
- Actor connection/player when applicable.
- Timestamp.
- Payload.

## Visible Transactions

A visible transaction groups one or more low-level events behind the action the table saw.

Examples:

- Player taps `Fold`.
- Final fold triggers `folded`, `pot-awarded`, and `hand-settled`.
- Player taps `Take all eligible pots`.
- Player confirms a split across multiple winners.

Undo operates at visible transaction level. Implementation (Slice 10): every
accepted command persists its resulting snapshot, so the latest transaction's
before-state is the snapshot stored at the previous transaction's sequence —
undo restores that snapshot directly, never by event replay. The client
previews what will be reversed via `GET /api/games/:code/undo-preview`
(transaction id, label, event tags) and submits `undo` with the previewed
`expectedTransactionId`; a table action landing in between makes the undo
reject as stale instead of reversing the wrong thing. An undo is itself a
visible transaction (`undo-committed`), so undoing an undo is a redo. After
an undo the server reconciles live seat claims against the restored snapshot
and re-broadcasts presence.

## State Restoration

On server start:

1. Open SQLite.
2. Load active games.
3. Load latest snapshot for each game when available.
4. Replay later events.
5. Mark seats without live connections as interrupted or reserved.
6. Rebuild in-memory indexes.

Clients reconnect through `/g/<code>`. A phone-side remembered profile/seat hint can preselect a claim, but the server validates it.

## SQLite Storage

Use one local SQLite database under the app/project data directory.

Suggested tables:

- `games`.
- `game_codes`.
- `player_profiles`.
- `game_players`.
- `events`.
- `snapshots`.
- `visible_transactions`.
- `finished_games`.
- `cash_settlements`.

Persistence rules:

- Accepted actions append events before broadcasting.
- SQLite uniqueness backs game-code collision prevention.
- Active games retain all events.
- Finished games retain final snapshot plus key audit/history events.
- Snapshots are optimization, not source of truth.

## Realtime Transport

Use Socket.IO rooms:

- One room per game code or game id.
- Optional room per host UI.
- Connection context includes socket id, optional local session hint id, claimed player id, and game id.

Socket events:

- Client to server: `command`.
- Server to client: `snapshot`.
- Server to client: `event-feed-entry`.
- Server to client: `presence-updated`.
- Server to client: `command-rejected`.
- Server to client: `command-ack`.

Do not use Socket.IO socket ids as stable player identity. Socket ids can change across reconnects and tabs. Use an app-level session/claim model instead.

The local session hint is silent browser-local state. It is not a user-facing browser-token requirement, not a password, and not authoritative. It can help preselect or recover a seat only when the server-side seat state allows it.

## Reconnect Strategy

Layered reconnect behavior:

1. Socket.IO automatic reconnect handles ordinary temporary transport loss.
2. App-level local session hint lets the same browser recover the same player when valid and when no other live connection currently owns that seat.
3. Active seat lock prevents another live connection from taking the seat.
4. Interrupted reserved state keeps the seat available for recovery without auto-folding.
5. Manual visible table action handles disaster recovery.

The app should synchronize full game state after reconnect because missed events are possible.

## Observability And Logging

The app is a live assistant for long poker nights: when something breaks at
the table, the host must be able to see what happened, and a later
maintenance session must be able to read stored logs, diagnose the issue,
and fix the code. Logging is therefore part of the architecture, not an
afterthought.

Goals:

- Diagnose connection issues between phones and the server (the highest-risk
  failure class) from stored evidence.
- Preserve enough runtime context that a future agent session can read the
  logs and improve the application without reproducing the issue live.
- Never let logging break gameplay: log calls cannot throw, and disk usage
  is bounded.
- Everything stays on the host machine. No cloud telemetry, ever.

Log format and storage:

- Structured NDJSON: one JSON object per line with `ts` (ISO), `level`
  (`error`/`warn`/`info`/`debug`), `event` (stable machine-readable name),
  `msg` (human line), and event-specific context fields.
- Dual sink: a compact human line to the host terminal (the server runs in a
  visible terminal per the manual-start model) plus NDJSON appended to
  `data/logs/pcc-YYYY-MM-DD.ndjson` next to the SQLite database.
- File writes are synchronous appends: at poker pace the cost is negligible,
  and the final lines before a crash are the ones that matter.
- Retention: a startup sweep deletes daily files older than 14 days or
  beyond a 50 MB total, oldest first. No in-process rotation complexity.
- `PCC_LOG_LEVEL` selects the level (default `info`). `PCC_LOG_DIR`
  overrides the log directory (tests use temp dirs).
- Session ids are truncated to 8 characters in log lines: they are silent
  reconnect hints and never belong in full in any output.

Event vocabulary (stable names; the drift check verifies each documented
event exists in code):

| Event | Level | Key fields |
|---|---|---|
| `server.start` | info | port, addresses, dbPath, node |
| `server.shutdown` | info | signal |
| `server.restore` | info | games, interruptedSeats |
| `server.fatal` | error | err (uncaught exception / unhandled rejection) |
| `runtime.heartbeat` | debug | games, sockets, rssMb, uptimeS |
| `socket.connect` | info | sid, gameCode, transport, remote |
| `socket.join_error` | warn | gameCode, reason |
| `socket.disconnect` | info | sid, gameCode, reason (Socket.IO disconnect reason: `ping timeout` vs `transport close` vs `client namespace disconnect` distinguishes phone sleep, Wi-Fi loss, and deliberate leave) |
| `socket.engine_error` | warn | code, message |
| `command.accepted` | info | cmd, code, actor, seat, vtx, events, durMs |
| `command.rejected` | info | cmd, code, actor, reason |
| `command.defect` | error | cmd, code, cause, stack — an unexpected pipeline failure; the full cause is never swallowed |
| `http.request` | debug | method, path, status, durMs (API routes only) |
| `http.error` | warn | method, path, status, err |
| `db.open` | info | path |
| `db.migrate` | info | from, to |
| `client.log` | varies | source=`client`, sessionId, gameCode, ua, plus the shipped entry |

Client log shipping:

- Phones buffer `warn`/`error` entries — window errors, unhandled
  rejections, React error-boundary catches, and socket lifecycle events
  (`connect_error`, `disconnect` with reason, `reconnect_attempt`,
  `reconnect`) — and POST them to `/api/client-logs` in small batches
  (flush every few seconds, immediately on error, and on page hide).
- The endpoint caps batch size and entry size, stamps `source: 'client'`,
  session id, and user agent, and writes through the server logger so all
  evidence from a table session lands in one host-side log file.
- Shipping is fire-and-forget: a failed POST never affects the client.

Correlation and the diagnosis loop:

- `command.accepted` lines carry the visible-transaction id (`vtx`), which
  joins against the `events`, `visible_transactions`, and per-transaction
  `snapshots` tables. Logs answer "what happened at the runtime/transport
  layer"; the event store answers "what it did to the game state".
- `pnpm logs:report [file]` summarizes a log file: counts by level and
  event, disconnect-reason histogram, defects with stacks, slowest
  commands, and client-shipped errors. It is the entry point for any
  investigation.
- The maintenance loop: read `data/logs/` (start with `pnpm logs:report`),
  diagnose, fix with a regression test at the lowest useful layer, and
  record the incident in the living plan. Every incident found through
  logs must leave a regression test behind.

## Game State Machine

High-level states:

- `setup`.
- `between-hands`.
- `in-hand`.
- `showdown`.
- `finished`.

Settlement happens inside `showdown`: the hand stays there until every pot
is resolved, then closes to `between-hands` (Slice 3 decision; the unused
`settling` literal was removed in Slice 12).

Street states:

- `pre-flop`.
- `flop`.
- `turn`.
- `river`.
- `showdown`.

Player hand states:

- `waiting`.
- `active`.
- `folded`.
- `all-in`.
- `out-of-hand`.
- `sitting-out`.
- `needs-rebuy`.

Connection states:

- `connected`.
- `interrupted`.
- `reserved`.
- `released`.

## Turn And Betting Logic

The reducer owns:

- Posting blinds.
- Selecting first actor.
- Advancing actor after fold/check/call/bet/raise/all-in.
- Detecting street closure.
- Highlighting `Next street`.
- Advancing dealer and blinds after settlement.

Position and raise rules:

- Heads-up with 2 players: dealer posts the small blind and acts first pre-flop; big blind acts first on later streets.
- The button skips empty, busted, and sitting-out seats. No casino dead-button rules.
- A blind owed by a short stack posts all-in for less.
- Returning sit-out players are dealt in next hand with no missed-blind penalty.
- Minimum raise derives from the raise-rule setting: `any` (default, call plus one step), `double`, or `standard` NLHE last-raise increment.
- An all-in below the rule minimum does not reopen betting for players who already acted: strict mode blocks their re-raise, soft mode warns.

Soft mode and strict mode share the same reducer, but strict mode adds blocking validation.

## Side-Pot Algorithm

Represent each player's committed chips and all-in cap.

When all-in thresholds exist:

1. Sort distinct commitment thresholds.
2. For each threshold band, calculate chips contributed by all contributors, including players who later folded.
3. Main pot contains the lowest contested threshold.
4. Side pots contain higher thresholds.
5. Eligible winners for each pot are the non-folded players who contributed to that threshold.

Each pot carries two separate sets:

- `contributors`: players whose committed chips fund the pot.
- `eligiblePlayerIds`: players who can win the pot.

Folded players can contribute chips but cannot remain eligible. This distinction is required for chip conservation.

## Cash Settlement

Chip value is a rational ratio derived from buy-ins and chips. Money is integer cents. Chips are integers.

At cash-out:

1. Sum buy-ins and rebuys.
2. Read final chip stacks.
3. Convert chips to cash-out cents.
4. Allocate rounding remainder explicitly so total cash-out equals total buy-ins.
5. Calculate net per player.
6. Minimize transfers from net losers to net winners.
7. Allow edits or external settlement override.

## Client Architecture

The client splits into two surfaces by route, never by device detection
(ADR 0002, SPEC.md Device Model): the table console at `/console` (table
lifecycle: create, configure, share QR all night, first dealer, overview,
history, stats) and the player surfaces at `/` (landing: join by code,
active-tables list) and `/g/<code>` (profile → seat → buy-in confirmation
→ play). No player surface can create a table.

`POST /api/games` no longer requires a profile (ADR 0002): the console
creates a table with no `creatorProfileId` at all, and the audit records
console origin (null) instead of a creator; a profile supplied but unknown
is still rejected. `GET /api/games` lists non-finished tables — `{code,
status, seatedCount, createdAt}` each, oldest first — for the player
landing's active-tables list.

Primary views:

- Console: table creation/settings, permanent share card, seated overview, first-dealer pick.
- Player landing: join by code, active-tables list.
- Join/profile/seat claim.
- Buy-in confirmation.
- Phone live table.
- Table action drawer (includes mid-game share card).
- Settlement.
- Cash-out.
- History/stats.

Client state:

- Server snapshot is canonical.
- Local state tracks selected amount, exact-entry field, pending confirmation modal, drawer state, and reconnect hint.
- Optimistic UI should be limited to local controls until server ack.

Phone action panel:

- Uses snapshot-derived legal/suggested actions.
- Does not calculate authoritative chip movement.
- Sends command with selected amount and client-visible transaction context.

### Insecure Contexts

Clients run in insecure contexts by design: the host serves plain HTTP over
the LAN (no internet dependency), and every phone that scans the join QR
code reaches it as `http://<lan-ip>:<port>`. HTTPS with a self-signed
certificate was considered and rejected — certificate interstitials on
every guest phone would break the scan-and-play onboarding promise.

Consequence: secure-context-only browser APIs (`crypto.randomUUID`,
`navigator.clipboard`, `navigator.share`, `navigator.wakeLock`,
`navigator.serviceWorker`, and any future addition to that family) are
`undefined` on every real player device, even though they work on
`localhost` during development. Code must never call one of these directly
without an explicit insecure-context fallback.

- `uuid()` in `src/client/uuid.ts` is the mandated ID source — it falls
  back to `crypto.getRandomValues` when `crypto.randomUUID` is absent.
- An ESLint `no-restricted-properties` rule (`eslint.config.js`, scoped to
  `src/client/**`) fails `pnpm lint` on direct use of any API in this
  family outside `src/client/uuid.ts`, so a violation is caught before the
  gate rather than on a real phone.
- The rule is syntactic and does not catch aliased or destructured member
  access; the Playwright E2E suite runs against an insecure-context origin
  as a runtime backstop for anything that evades it.

## Design System

The selected design direction is Deep Stack Logic.

The app-level design contract lives in [DESIGN.md](DESIGN.md), derived from the Stitch `House Poker Manager` mobile screens. Use `SPEC.md` for behavior and `DESIGN.md` for visual implementation details:

- Dark tonal layers.
- Utility-first table instrument.
- Emerald active action.
- Amber warning/sit-out.
- Clear status badges.
- Large numeric stack/pot values.
- Sparse action panel.

## Testing Strategy

The detailed test plan lives in [TESTING.md](TESTING.md).

The implementation should use:

- Vitest for unit, integration, and realtime Socket.IO tests.
- Real temporary SQLite database files for persistence tests.
- Browser automation, agent-driven or a committed Playwright harness, for browser E2E and phone viewport coverage.
- One validation gate, `pnpm validate`, once the runtime project exists.

## Validation Strategy

Domain tests:

- Chip conservation.
- Turn order.
- Street closure.
- Soft vs strict raise handling.
- Side-pot construction.
- Pot eligibility.
- Split allocation.
- Undo visible transaction.
- Rebuy timing.
- First buy-in equals the table default; rebuy at most the default (ADR 0002).
- Cash-out rounding and transfer minimization.

Persistence tests:

- Event append transaction.
- Snapshot restore.
- Restart recovery.
- Multiple active games.
- Code collision regeneration.

Realtime tests:

- Two or more clients in one game room.
- Active player action accepted.
- Non-active normal action rejected.
- Table action accepted from non-active player.
- Reconnect and interrupted seat behavior.

UI tests:

- Phone portrait live hand fits without core scrolling.
- Landscape prompt appears.
- Action panel has no quick-chip bank.
- Setup contains required fields.
- Settlement shows ordered pots and exact split feedback.

Manual QA:

- Host starts server; the console opens, creates the table, and shows the QR.
- Phone joins over LAN, claims a seat, and confirms the buy-in.
- Complete one normal hand.
- Complete one all-in side-pot hand.
- Restart server and recover active game.

## External References

- Effect docs: `https://effect.website/docs/getting-started/introduction/`
- Effect Schema docs: `https://effect.website/docs/schema/introduction/`
- Effect runtime docs: `https://effect.website/docs/runtime/`
- Socket.IO connection recovery docs: `https://socket.io/docs/v4/connection-state-recovery`
- Socket.IO disconnection docs: `https://socket.io/docs/v4/tutorial/handling-disconnections`
