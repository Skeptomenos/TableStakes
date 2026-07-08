# Poker Chip Counter

Local-first web app for tracking poker chip stacks and pots during in-person games.

## Identity
- **Status:** MVP implemented (Slices 0-12 of the implementation plan)
- **Tech:** TypeScript, Node.js, React, Vite, Socket.IO, SQLite (better-sqlite3), Effect (Schema + command pipeline), Vitest, Playwright browser E2E
- **Stitch project:** House Poker Manager (`projects/4189937017243751264`)

Read `index.md` for project metadata.

## Rules
- Investigating a runtime issue? Start with the stored logs: `data/logs/pcc-*.ndjson` on the host, summarized via `pnpm logs:report`. Correlate `vtx` ids in log lines with the SQLite `events`/`snapshots` tables for full state forensics. Every incident diagnosed from logs must leave a regression test behind. See `ARCHITECTURE.md` Observability And Logging.
- Optimize for phone-first PLAY - players need one-tap actions during a live hand. Table lifecycle (create, configure, share, first dealer) lives on the laptop console at `/console` (ADR 0002); surfaces separate by route, never by device detection.
- Preserve local-first operation - the app must work from a host laptop over the LAN without external accounts.
- Treat chip balance changes as auditable - pot mistakes need a visible correction path. Buy-ins are exactly the table default; rebuys are capped at the default (ADR 0002, domain-enforced).
- Keep poker rules configurable - home games vary, and chip accounting must not force one betting style too early.
- Use `DESIGN.md` as the local design contract. It was derived from the Stitch `House Poker Manager` mobile screens on 2026-07-01; the console and landing surfaces (2026-07-08, ADR 0002) reuse its patterns rather than new Stitch screens.
- When Stitch project metadata conflicts with `SPEC.md`, follow `SPEC.md` for behavior and `DESIGN.md` for visual implementation.

## Stitch Metadata

- **Project ID:** `4189937017243751264`
- **Resource:** `projects/4189937017243751264`
- **Primary device:** mobile portrait (gameplay surfaces; the `/console` table surface targets laptop viewports and has no Stitch screen — ADR 0002)
- **Visible screens:** `MVP Join & Seat Selection`, `Join Game`, `Select Player`, `MVP Setup Game`, `Admin Setup`, `MVP Table Play`, `10-Player Poker Table Overview`, `MVP Hand Settlement`. (`MVP Setup Game`/`Admin Setup` show the retired bundled setup form; their fields now split across console creation and the phone buy-in confirmation.)
