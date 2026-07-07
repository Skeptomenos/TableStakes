# Poker Chip Counter

Poker Chip Counter is a local-first web app for casual private poker games where players want phone-based chip accounting instead of physical chips.

The host starts a local server on a laptop. A player creates a game with a selected or new local profile and receives a short game URL. Other players join from phones on the same network — via QR code, the full URL, or by typing the five-digit code on the home screen — claim or reconnect to a player seat, and use the app to track stacks, bets, folds, the pot, and pot settlement. There is no privileged admin role: settings are shared, audited controls.

## Development

The app is an app-local pnpm package (Node 22+). pnpm is provided through corepack:

```bash
corepack enable pnpm
cd apps/poker-chip-counter
pnpm install
pnpm exec playwright install chromium   # one-time, for browser E2E smoke
```

Common commands:

- `pnpm dev` - run the Node server and Vite client together for development.
- `pnpm build && pnpm start` - build and boot the production server (default port 8080, LAN-reachable).
- `pnpm validate` - the single validation gate: build, typecheck, lint, unit/integration/realtime tests, built-artifact smoke, browser E2E smoke, and docs drift checks. Green `pnpm validate` is required before any implementation claim.
- Runtime logs: structured NDJSON under `data/logs/` (daily files, bounded retention), level via `PCC_LOG_LEVEL`. `pnpm logs:report` summarizes a log file for issue investigation - see `ARCHITECTURE.md` Observability And Logging.

## Initial Scope

- Local network game server reachable from phones on the same Wi-Fi or LAN.
- Manual server startup for MVP, with guided LAN URL and reachability checks.
- Short game URLs for joining a table, with QR code and five-digit code sharing.
- Player join and reconnect flow using lightweight reusable local profiles and reusable seats.
- One compact first-hand setup screen for currency, default buy-in money, default chip stack, small blind, big blind, seating order, dealer button, and strict mode defaulting off.
- Manual blind amount changes in game settings between hands, with no automatic blind progression.
- Phone-portrait player UI showing own stack, pot, current turn, table state, and available actions without core in-hand scrolling.
- Host/larger-screen views for setup, game sharing, table overview, history, and stats.
- Minimal table visualization with players arranged around the table and community-card placeholders for street state.
- Hand accounting for blinds, bets, calls, raises, checks, folds, all-in states, side pots, and pot settlement.
- Soft default mode with minimal guardrails for chip conservation and turn order, including normal actions locked to the active claimed seat while bet/raise amounts stay loose.
- Sparse phone action panel with a direct call/check button, auto-selected minimum/suggested bet amount, slider plus minus/plus controls, configurable step size, tappable exact-entry amount display, and no preset quick-chip buttons.
- Slider range from current minimum/suggested amount to remaining stack, with `Bet`/`Raise` submitting the selected amount directly and `All-in` remaining separate.
- Soft-mode warning for below-minimum raises, strict-mode blocking, `Call All-in <stack>` for short-stack calls, and full-stack bet/raise normalization to confirmed all-in.
- Configurable raise rule in game settings: `Any raise` default, `Double`, or `Standard NLHE` increment, applied from the next hand.
- `Call All-in <stack>` in the normal call button position, uncontested pot auto-award after final fold, and explicit side-pot settlement order.
- Showdown settlement with `Take all eligible pots` when one winner can receive every pot, otherwise pot-by-pot settlement with exact-chip split allocations.
- Confirmation policy that keeps check/call/standard bet/raise fast while confirming fold, all-in, pot settlement, rebuy, correction, reset/delete, and cash-out settlement.
- Confirmed transaction-level undo, where bundled outcomes such as final fold plus auto-award reverse together.
- Winner flow for taking the whole pot or splitting by amount.
- Reconnect and disaster-recovery flow that preserves a disconnected player's seat without active timeout-based release.
- Interrupted-player state for phone sleep or network loss, with no automatic fold on disconnect.
- Sit-out state for players skipping upcoming hands.
- Rebuy/add-chips table action and end-of-night cash-out settlement suggestions.
- Rebuy timing that protects active-hand side pots, zero-chip needs-rebuy state, and editable minimized payment transfers.
- SQLite local persistence so active games survive server restart or laptop sleep.
- Multiple active games keyed by five-digit code, with collision regeneration and restart recovery through `/g/<code>`.
- Finished-game history with session-level player stats.
- Host-owned local player profiles so stats can aggregate across game nights, with phone-side remembered reconnect hints.
- Comprehensive testing across unit, integration, realtime Socket.IO, and browser E2E layers.
- Auditable event feed and manual correction path.

## Non-Goals For The First Build

- Online hosting or accounts.
- Card dealing, hand evaluation, or full poker-room automation.
- Rake, casino analytics, bankroll profiles, or gambling-business dashboards.
- Poker-strategy analytics such as VPIP, PFR, bluff metrics, or hand-level performance charts.
- User accounts, email login, passwords, or cloud identity.
- Profile sync between different host laptops.
- Landscape gameplay optimization.
- Preset quick-chip button banks for bet/raise shortcuts.
- Advanced setup flows before the first hand unless playtesting proves they are needed.
- Automatic blind schedules, blind timers, tournament levels, or automatic blind increases.
- Antes, straddles, or bomb pots.
- Background daemon/service installation, reverse proxy setup, Tailscale setup, or packaged desktop wrappers.
- Tournament management beyond stack/blind setup.

## Planning

- [Product specification](SPEC.md)
- [Technical architecture](ARCHITECTURE.md)
- [Testing strategy](TESTING.md)
- [Design contract](DESIGN.md) - Deep Stack Logic tokens, Stitch metadata, and screen-level implementation rules.
- [Project metadata](index.md)
- [ADR 0001: Local table chip accounting](./_planning/adr/0001-local-table-chip-accounting.md)
- [MVP implementation handoff](./_planning/plans/2026-07-01-implement-poker-chip-counter-mvp.md) - comprehensive vertical-slice plan for implementation agents.
- [Initial MVP checklist](./_planning/plans/2026-06-28-build-poker-chip-counter-mvp.md) - original scope capture and planning history.
