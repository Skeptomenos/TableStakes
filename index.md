# Poker Chip Counter

> Status: MVP implemented
> Type: Private
> Tech: TypeScript, Node.js, React, Vite, Socket.IO, SQLite (better-sqlite3), Effect, Vitest, Playwright browser E2E

Local-first phone web app for counting poker chips, tracking pots, and coordinating turn state during in-person home games.

## Product Direction

Poker Chip Counter should feel like a shared table remote. The laptop hosts the authoritative game state, while phones provide fast player actions and a compact view of stacks, pot size, current turn, and table position.

The app is intentionally not a card engine. It should handle the chip math, table order, and settlement workflow while leaving cards and hand evaluation to the players.

## Key Documents

- [README.md](README.md) - project overview and initial scope.
- [SPEC.md](SPEC.md) - product behavior contract and MVP acceptance criteria.
- [ARCHITECTURE.md](ARCHITECTURE.md) - technical architecture, domain boundaries, persistence, realtime sync, and Effect usage.
- [TESTING.md](TESTING.md) - unit, integration, realtime, E2E, and validation-gate strategy.
- [DESIGN.md](DESIGN.md) - Deep Stack Logic design contract, Stitch metadata, and screen-level UI rules.
- [_planning/adr/0001-local-table-chip-accounting.md](_planning/adr/0001-local-table-chip-accounting.md) - accepted decision summary for local table chip accounting.
- [_planning/plans/2026-07-01-implement-poker-chip-counter-mvp.md](_planning/plans/2026-07-01-implement-poker-chip-counter-mvp.md) - comprehensive vertical-slice MVP implementation handoff.
- [_planning/plans/2026-06-28-build-poker-chip-counter-mvp.md](_planning/plans/2026-06-28-build-poker-chip-counter-mvp.md) - initial scope checklist and planning history.

## Catalog

- Parent catalog: [../index.md](../index.md)
- Root catalog: [../../index.md](../../index.md)
