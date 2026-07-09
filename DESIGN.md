---
name: Felt & Ledger
colors:
  felt-950: '#0e1210'
  felt-900: '#151b17'
  felt-850: '#1b221e'
  hairline: '#2a332d'
  ivory: '#e9e5d9'
  ivory-dim: '#9aa39c'
  emerald-500: '#10b981'
  emerald-900: '#0b3b2c'
  emerald-ink: '#04241a'
  amber-400: '#e8a33d'
  amber-ink: '#3a2a08'
  claret-500: '#a83e43'
typography:
  display-pot:
    fontFamily: JetBrains Mono Variable
    fontSize: 34px
    fontWeight: '700'
    lineHeight: 37px
    numeric: tabular-nums
  stack-value:
    fontFamily: JetBrains Mono Variable
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 20px
    numeric: tabular-nums
  headline-player:
    fontFamily: Inter Variable
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  body-main:
    fontFamily: Inter Variable
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter Variable
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    transform: uppercase
  chip-badge:
    fontFamily: Inter Variable
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 12px
  puck:
    fontFamily: JetBrains Mono Variable
    fontSize: 8.5px
    fontWeight: '700'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  card: 10px
  full: 9999px
spacing:
  base: 4px
  card-padding: 12px
  gutter: 8px
  safe-margin: 16px
---

# Poker Chip Counter Design

Status: Implemented contract — Felt & Ledger (visual v2, approved and locked 2026-07-07, implemented 2026-07-07)
Last reviewed from Stitch: 2026-07-01 (superseded as visual target by the Felt & Ledger uplift)

The app renders the "Felt & Ledger" design: felt-tinted black surfaces, warm ivory ink,
JetBrains Mono ledger numerals for every chip/money figure, chip-puck position markers, and a
stadium-rail table with fixed-geometry player cards centered ON the rail at equal arc-length
steps. Emerald strictly means "you can act"; amber is attention; claret appears only inside
destructive confirmation sheets. Fonts are self-hosted (variable woff2) so the app looks right
on a LAN with no internet.

## Stitch Source

- Stitch project title: House Poker Manager
- Stitch project id: `4189937017243751264`
- Stitch resource: `projects/4189937017243751264`
- Visibility: private
- Primary device: mobile portrait
- Current Stitch project update time: 2026-07-01T11:58:19.108274Z

Visible Stitch screens used for this document:

- `MVP Join & Seat Selection` - `projects/4189937017243751264/screens/46881acdf10e49d28a29f81a3b6944f8`
- `Join Game` - `projects/4189937017243751264/screens/c7d7643428504673acec19da00491853`
- `Select Player` - `projects/4189937017243751264/screens/f8d08f2e11dd43f383be051e91e23f13`
- `MVP Setup Game` - `projects/4189937017243751264/screens/a8b5d8d8db9f4e75b008ce320da2395a`
- `Admin Setup` - `projects/4189937017243751264/screens/e556030ccca7425aaca6c8097466bdfc`
- `MVP Table Play` - `projects/4189937017243751264/screens/b4f0d44b82e64b479e391d5ee099dab6`
- `10-Player Poker Table Overview` - `projects/4189937017243751264/screens/28fbf9cd46bf49638501b136b219eaaa`
- `MVP Hand Settlement` - `projects/4189937017243751264/screens/ae598352f7cf4a839b50edb37f56729a`

The Stitch project still exposes older theme text in some metadata. When that conflicts with this file, this file wins. The implemented product uses Felt & Ledger (which superseded the earlier Deep Stack Logic language on 2026-07-07), not Midnight Casino, glassmorphism, decorative card dealing, or casino-room styling. Stitch screens may also show five-character alphanumeric table codes such as `#A7B29`; that is stale. Game codes are five-digit numeric codes per `SPEC.md`. The `Admin Setup` screen title is also stale: the MVP has no privileged admin role, and setup is a shared audited surface.

## Product Fit

Felt & Ledger is a dark, utilitarian, phone-first table instrument for private in-person poker games. The interface should feel like a precise shared ledger and table remote: compact, calm, numeric, and fast under low light.

The design should not feel like:

- A marketing site.
- A casino game.
- An online poker room.
- A decorative felt-table simulator.
- A financial dashboard disconnected from live table play.

## Visual Principles

- Phone portrait is the primary surface.
- Gameplay screens optimize for one-handed use and live-table speed.
- Dark tonal layers create hierarchy; borders stay subtle and functional.
- Emerald marks active or primary action.
- Amber marks warnings, sit-out, interrupted, and recovery states.
- Red/error marks destructive or high-risk actions such as all-in and delete.
- Large numbers are reserved for stack, selected bet amount, and pot values.
- Cards are only community-card placeholders. Do not render card faces, suits, player hole cards, or decorative playing-card backs.
- No preset quick-chip button bank appears in the MVP action panel.

## Color Usage

The YAML tokens above are the source of truth.

- Background: `felt-950` (`#0e1210`) — felt-tinted black, never neutral gray.
- Cards: `felt-900` (`#151b17`); raised surfaces (hero card, action bar, sheets): `felt-850` (`#1b221e`).
- Borders and dividers: `hairline` (`#2a332d`), 1px — depth without shadows.
- Text: `ivory` (`#e9e5d9`); secondary text and labels: `ivory-dim` (`#9aa39c`).
- Act-now: `emerald-500` on primary actions, the turn ring/badge, and the live pot figure. Text on emerald is `emerald-ink`, never white. Emerald appears NOWHERE else — not on headings, the wordmark, or static text.
- Attention (interrupted, soft warnings): `amber-400` with `amber-ink` for text on amber.
- Destructive: `claret-500` ONLY inside confirmation sheets (fold/all-in/reset confirms). Resting buttons are never claret — the gap analysis explicitly rejected red-at-rest.
- Sitting-out is a deliberate pause: outlined `ivory-dim` pill with a `⏸` glyph — visually distinct from amber problem states.

Do not introduce a broader palette. The product reads as felt-black, ivory, one emerald, one amber, one claret.

## Typography

Two faces, self-hosted as variable woff2 under `src/client/app/fonts/` (the app must render correctly on an offline LAN — never load fonts from a CDN):

- **JetBrains Mono Variable** — every chip/money figure: stacks, bets, pots, blinds, codes, money columns, correction/rebuy inputs. Always `font-variant-numeric: tabular-nums` so amounts align like a ledger. The `.num` utility class applies this role.
- **Inter Variable** — all other UI text.

Typography rules:

- Numbers are the product; they get the mono face everywhere, without exception.
- Keep letter spacing at `0` for numerals (the five-digit code input may use wide tracking).
- Uppercase labels sparingly for short metadata: `MAIN POT`, `JOIN A GAME`, section titles (12px/600).
- Long player names truncate with ellipsis — never change card dimensions.

## Shape And Density

- Player cards: 10px radius; other cards/controls 8px; pills 999px.
- **Player cards have FIXED geometry: 96×64px, always.** No badge or state may change a card's size (locked decision 2). Pucks and status pills float outside the border box.
- Bottom sheets may use a larger top radius up to 16px.
- 4px spacing rhythm, 8px gutters, 12px card padding, 44px minimum touch targets.
- Hairline (1px `hairline`) on every raised surface; no drop-shadow depth except the puck's small lift shadow.

## App Shell

The live gameplay shell follows the Stitch `MVP Table Play` screen:

- A compact top bar shows a menu icon, the five-digit table code such as `#48317`, a `Manage` pill, and overflow.
- The live table canvas occupies the remaining middle area.
- The action panel is fixed to the bottom.
- The table view must not require core in-hand scrolling in phone portrait.
- Any optional ledger/feed/history is behind `Manage` or a drawer, not always visible in the live action area.

## Join And Seat Selection

Stitch has two related entry screens: `Join Game` and `MVP Join & Seat Selection`.

Required elements:

- Title: `Join Local Game`.
- Full local URL display, for example `http://192.168.1.5:8080/g/48317`.
- Manual game-code input (on the player landing `/`: type the five-digit code, land on `/g/<code>`).
- Active-tables list on the player landing: one row per open table (code, seated count), tap to join (ADR 0002).
- `Connect to Table` or `Claim Seat` primary action.
- Profile selection section labeled `Select or Create Profile`. Selecting a profile only selects it — no navigation side effects, and never any table creation on a player surface.
- Local profile rows such as `Alex (Local)` and `Sarah (Local)`.
- `Create New Profile` row with a person-add icon.
- After claiming a seat: the buy-in confirmation screen — the fixed table default stated plainly (`Buy in for 10 EUR → 1,000 chips`), one primary confirm action, no amount entry (ADR 0002).

An in-app QR scanner affordance is OUT of MVP scope (Slice 12 decision): the phone camera app scans the share-screen QR natively and opens `/g/<code>` directly, so an in-app scanner would duplicate the OS. Revisit only if playtesting shows players cannot find their camera.

Seat claiming screen states:

- Locked seats show a lock icon and `Locked`.
- Available seats show `Claim Seat`.
- Interrupted seats use amber and show `Reclaim`.
- Released seats show `Claim Seat`.
- No PIN, password, account login, or user-facing browser-token field appears.

## First-Hand Setup

Setup splits across surfaces (ADR 0002, SPEC.md First-Hand Setup). The
table-settings screen lives on the console and follows `MVP Setup Game` /
`Admin Setup` visually; buy-in confirmation lives on the phone.

Console table-settings fields:

- Currency.
- Buy-in money.
- Default stack.
- Small blind.
- Big blind.
- Strict mode toggle, default off.

Console after creation: permanent share card (QR, URL, code), the seat
overview from seat 1 through seat 10 with `[Empty]` rows filling live, and —
once two or more players have bought in — dealer selection shown as a
single dealer marker on exactly one player plus the start action.

Setup rules:

- Show the money-to-chip relationship directly, for example `10 EUR = 1000 chips`.
- Do not label chips as the currency.
- Disabled primary actions state their reason in one short line (for example `Waiting for a second player to buy in`).
- The screen can scroll during setup; this is not a live-hand screen.

## Live Table

The live table implements the locked Felt & Ledger geometry (see `src/client/components/table-layout.ts`):

Table layout:

- The rail is a **stadium/racetrack** — straight sides with true semicircular ends, like real felt — rendered as a rounded rect with `border-radius = half the rail width`, a 1.5px border, felt radial gradient fill, and an inner betting line (hairline inset 12px). Not an ellipse.
- **Card centers sit exactly ON the rail**, placed at **equal arc-length steps** along its perimeter — equal center-to-center distances between all adjacent cards (measured ≤5% chord spread at 6–10 seats).
- The hero (your claimed seat) is ring index 0, pinned to **bottom-center**; other players follow in seat order CLOCKWISE as the viewer sees the screen — the next seat renders to the hero's LEFT, matching real deal order (walk: bottom → left → top → right). Spectators see the first seated player at bottom-center. Direction never changes mid-game.
- Straight sides cap at 0.8× the arc radius on tall canvases; leftover vertical space centers the ring.
- Ten seats fit in phone portrait with zero overlaps and no in-hand scrolling.

Player cards (fixed 96×64):

- Player name (truncating), mono stack, muted mono `Bet <amount>` line.
- **Dealer/blind pucks float on the top-left corner**: 21px circles with a dashed inner ring and lift shadow — D is an ivory puck (like the real button), SB/BB are rimmed dark chips. Pucks are amount-less; blind amounts live in the action-bar context line.
- **ONE status pill hovers centered over the bottom border**: priority Interrupted (amber) > Needs rebuy (amber, ADR 0003 — the whole table sees why the game is paused) > Your Turn/Thinking (emerald-deep with emerald ring) > All-in (claret) > Folded (hairline on felt) > ⏸ Sitting out (outlined muted).
- The hero card is felt-850, scaled 1.15× about its center (layout box unchanged), with an emerald border + soft glow when it is your turn.
- Folded players dim to 55% opacity and lose stack weight — state is opacity + shape, not just a chip.

## Street And Pot Center

The table center is a compact stack, positioned by the layout module:

- Always five community-card placeholders (dashed hairline, 20% quieter than before), filling per street 0/3/4/5.
- **The main pot is the table's one dominant figure**: `MAIN POT` uppercase label over a 34px emerald mono amount (live total includes current-street commitments).
- Side pots render as compact hairline ledger rows beneath the main figure (label · mono amount · eligible names).
- Do not render card faces, suits, or hole cards — placeholders only.

## Phone Action Panel

The bottom action panel follows the Stitch `MVP Table Play` screen and the product spec.

Layout order:

1. Blinds and minimum context row:
   - left: `Blinds: 50 / 100`
   - right: `Min Raise: 200`
2. Horizontal amount slider:
   - minus icon button on the left.
   - slider track and handle in the middle.
   - plus icon button on the right.
3. Tappable exact amount display:
   - edit icon.
   - selected amount such as `600`.
   - optional context text such as `Bet: 600`.
4. Sparse action row:
   - `Fold`
   - `Check` or `Call <amount>`
   - `Bet <amount>` or `Raise <amount>`
   - `All-In`

Action rules:

- `Check`, `Call`, standard `Bet`, and standard `Raise` commit without extra confirmation.
- `Fold` opens confirmation.
- `All-In` opens confirmation.
- If the player cannot fully call, the normal call slot becomes `Call All-in <stack>`.
- If selected bet/raise equals the player's stack, normalize to `All-In` and confirm.
- There is no quick-chip button bank such as `+1 BB`, `+5 BB`, or `Half stack`.
- There is no separate amount-selection mode; `Bet` or `Raise` submits the currently selected amount.

Amount rules:

- Slider min is the current suggested/current legal amount.
- Slider max is the active player's remaining stack.
- Plus/minus default to small-blind increments with minimum one-chip step.
- Exact amount entry opens only when the central amount is tapped.
- In soft mode, exact entry may go below the slider minimum after a warning.
- In strict mode, below-minimum entries are blocked.

## Manage Drawer And Table Actions

The `Manage` pill is the entry point for non-routine table actions.

The manage surface should include:

- Undo latest visible transaction.
- Correction tools.
- Game settings: blinds, raise rule, strict mode, amount step size.
- Release or reclaim interrupted seat.
- Mark interrupted player folded.
- Sit out next hand.
- Return from sit-out.
- Rebuy or add chips: quick-picks `Full` / `Half` / `Custom`, custom capped at the table default (ADR 0002).
- Share this table: the share card (QR, URL, code) for mid-game late arrivals.
- Award or split pot.
- Cancel hand.
- Finish game and start cash-out.

Keep these actions out of the live bottom action row. The live row is only for active-seat poker actions.

## Hand Settlement

The settlement screen follows `MVP Hand Settlement`.

Required structure:

- Header title: `Hand Settlement`.
- Total pot summary, for example `Total Pot Size 1,650`.
- Pot sections in display order: `Main Pot`, `Side Pot 1`, `Side Pot 2`.
- Selected winner rows with initials/avatar, name, and eligibility.
- `Take All Eligible` action only after a winner is selected and only when that player can receive every unresolved pot.
- Settled pots show a clear `Settled` status.
- Split mode labels `Split Pot` and opens with a chop selection: one checkbox row per eligible player (ADR 0003).
- Selecting players allocates the pot evenly at once (odd chips to the earliest seats after the dealer); the shares render immediately, never zeros.
- Two selected players: a single zero-sum slider between the two shares. Three or more: per-player `−`/`+` steppers in the table's amount step, pulling from the largest other share. The pot stays 100% allocated through every adjustment.
- Exact chip inputs remain as the fallback, pre-filled with the even split.
- Split mode shows live remaining-unallocated feedback: `Remaining Unallocated:` or `Remaining:`.
- Split mode includes `Cancel` and `Confirm Split`.
- `Next Hand` remains disabled until every pot is settled, and stays disabled with a one-line stated reason while fewer than two seated players have chips ("Waiting for players to rebuy" — ADR 0003, same disabled-reason pattern as Review Rebuy).

Settlement interactions require confirmation before chip movement is committed.

Needs-rebuy prompt (ADR 0003): between hands, a player whose own seat is `needs-rebuy` sees a card over the idle action-panel area — "You're out of chips." with a primary one-tap `Rebuy <default> → <stack> chips` (confirm sheet), a smaller `Custom rebuy` secondary opening the Manage drawer's rebuy view preselected to that player, and `Sit out`. A card with choices, never a blocking modal.

## Cash-Out And History

Stitch does not yet provide a complete cash-out/history screen. Implement it using the same Felt & Ledger patterns:

- Charcoal full-screen surface.
- Dense table-style rows instead of decorative cards.
- Per-player buy-ins, rebuys, final chips, cash-out value, and net result.
- Editable minimized transfers.
- Explicit rounding remainder when present.
- Finished-game history derives from local player profiles and finished-game summaries.

## Console And Desktop Surfaces

Stitch does not provide desktop screens. The table console (`/console` — creation, settings, permanent share card, seat overview, first-dealer pick, history, stats) reuses the same Felt & Ledger patterns:

- Same color tokens, Inter typography, and badge language as the mobile screens.
- Dense table-style rows and wider multi-column layouts instead of new decorative components.
- The console enlarges the QR code and full URL for across-the-table scanning, and keeps them visible all night.
- Phones reach the same share card mid-game from the Manage drawer.
- No new Stitch screens are required.

## Accessibility And Contrast

- Every text/background token pair in use passes WCAG AA (4.5:1). Audited 2026-07-07: ivory on felt-950/900/850 = 14.99/13.88/12.88; ivory-dim on felt-950/900/850 = 7.27/6.74/6.25; emerald-500 on felt-950 = 7.44; emerald-ink on emerald-500 = 6.51; emerald-500 on emerald-900 = 4.94; amber-ink on amber-400 = 6.43; amber-400 on felt-850 = 7.52; ivory on claret-500 = 4.85 (claret darkened from the draft value for exactly this).
- Emerald buttons use `emerald-ink` text; white text on emerald is not allowed.
- Keyboard focus is always visible: 2px emerald `:focus-visible` ring, offset 2px, on every interactive element.
- `prefers-reduced-motion: reduce` collapses all transitions/animations.
- Icon-only controls must have accessible names.
- Status must not be color-only; use badges such as `Locked`, `Folded`, `Reclaim`, `All-in`, and `Your Turn`.
- Button labels must fit at 390px phone width without truncating core action amounts.
- Keep touch targets at least 40px high/wide for action and icon buttons.

## Implementation Notes

- Treat this file as the implementation design contract when Stitch metadata conflicts with generated HTML or older theme text.
- The implementation may use the screen HTML as a visual reference, but must follow `SPEC.md` for behavior.
- Do not copy generated Stitch code directly if it conflicts with the architecture boundaries.
- Use browser-automation E2E to verify phone portrait layout, action-panel fit, settlement flow, and rotate prompt.
