---
name: Deep Stack Logic
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#bbcabf'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#86948a'
  outline-variant: '#3c4a42'
  surface-tint: '#4edea3'
  primary: '#4edea3'
  on-primary: '#003824'
  primary-container: '#10b981'
  on-primary-container: '#00422b'
  inverse-primary: '#006c49'
  secondary: '#ffb95f'
  on-secondary: '#472a00'
  secondary-container: '#ee9800'
  on-secondary-container: '#5b3800'
  tertiary: '#ffb3ad'
  on-tertiary: '#68000a'
  tertiary-container: '#ff7a73'
  on-tertiary-container: '#79000e'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-pot:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: 0
  headline-player:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0
  headline-player-mobile:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0
  stack-value:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: 0
  body-main:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0
  chip-badge:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  card-padding: 12px
  gutter: 8px
  safe-margin: 16px
---

# Poker Chip Counter Design

Status: Draft implementation contract
Last reviewed from Stitch: 2026-07-01

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

The Stitch project still exposes older theme text in some metadata. When that conflicts with this file, this file wins. The implemented product uses Deep Stack Logic, not Midnight Casino, glassmorphism, decorative card dealing, or casino-room styling. Stitch screens may also show five-character alphanumeric table codes such as `#A7B29`; that is stale. Game codes are five-digit numeric codes per `SPEC.md`. The `Admin Setup` screen title is also stale: the MVP has no privileged admin role, and setup is a shared audited surface.

## Product Fit

Deep Stack Logic is a dark, utilitarian, phone-first table instrument for private in-person poker games. The interface should feel like a precise shared ledger and table remote: compact, calm, numeric, and fast under low light.

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

- Background: `background` / `surface` (`#131313`).
- Low panels: `surface-container-low` (`#1c1b1b`).
- Cards and controls: `surface-container` (`#201f1f`) and `surface-container-high` (`#2a2a2a`).
- Text: `on-surface` (`#e5e2e1`) and `on-surface-variant` (`#bbcabf`).
- Active and primary affordance: `primary` (`#4edea3`) or `primary-container` (`#10b981`).
- Primary text on emerald: always use `on-primary` or `on-primary-container`, never white.
- Dealer and highlight markers: `secondary-container` with `on-secondary-container`.
- Sit-out, interrupted, and warning states: `secondary` or `secondary-container`.
- All-in, destructive, and high-risk states: `error` or `error-container`.

Do not introduce a broad secondary palette during MVP implementation. The product should read as charcoal, emerald, amber, and red accents.

## Typography

Use Inter for all MVP UI. The Stitch screens currently use Inter across labels, stacks, and controls; keep that consistency.

Typography rules:

- Use tabular numeric rendering where available for stacks, pots, and bet values.
- Keep letter spacing at `0`. Do not use negative tracking for dense numbers.
- Use uppercase labels sparingly for short metadata: `MAIN POT`, `BLINDS`, `MIN RAISE`, `LOCKED`.
- Avoid hero-sized type inside compact panels.
- Ensure long player names truncate or wrap without changing card dimensions.

## Shape And Density

- Standard card and control radius is 8px.
- Bottom sheets may use a larger top radius up to 16px.
- Icon buttons may be circular when the icon is the primary label.
- Repeated player cards must have stable dimensions so status badges, stack changes, and hover/active states do not shift the table layout.
- Use 4px spacing rhythm with 8px gutters and 12px card padding.
- Avoid nested cards. A player card can sit on the table view; do not place separate decorative cards inside it.

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
- Manual game-code input (implemented on the home screen: type the five-digit code, land on `/g/<code>`).
- `Connect to Table` or `Claim Seat` primary action.
- Profile selection section labeled `Select or Create Profile`.
- Local profile rows such as `Alex (Local)` and `Sarah (Local)`.
- `Create New Profile` row with a person-add icon.
- Recent games may appear as a convenience, but must not replace direct URL/code joining.

An in-app QR scanner affordance is OUT of MVP scope (Slice 12 decision): the phone camera app scans the share-screen QR natively and opens `/g/<code>` directly, so an in-app scanner would duplicate the OS. Revisit only if playtesting shows players cannot find their camera.

Seat claiming screen states:

- Locked seats show a lock icon and `Locked`.
- Available seats show `Claim Seat`.
- Interrupted seats use amber and show `Reclaim`.
- Released seats show `Claim Seat`.
- No PIN, password, account login, or user-facing browser-token field appears.

## First-Hand Setup

The setup screen follows `MVP Setup Game` and `Admin Setup`.

Required fields:

- Currency.
- Buy-in money.
- Default stack.
- Small blind.
- Big blind.
- Strict mode toggle, default off.
- Seating order from seat 1 through seat 10.
- Dealer selection shown as a single dealer marker on exactly one player.

Setup rules:

- Show the money-to-chip relationship directly, for example `10 EUR = 1000 chips`.
- Do not label chips as the currency.
- Empty seats show `[Empty]` plus an add-player affordance.
- The primary completion action is `Start Game`.
- The screen can scroll during setup; this is not a live-hand screen.

## Live Table

The live table follows `MVP Table Play` and `10-Player Poker Table Overview`.

Table layout:

- A simple vertical oval table outline sits behind players.
- Ten player seats can fit around the oval in portrait.
- Player cards remain compact and stable.
- The user's own active card may be larger than passive cards.
- The active claimed seat uses an emerald ring or subtle emerald tint and a `Your Turn` label.
- Folded players are visually muted with a `Folded` badge.
- Thinking/current actor states can use a small emerald `Thinking` badge.
- Dealer marker is a compact `D` badge.
- Blind marker can appear as `BB 100` or `SB 50`.
- Sitting-out uses an outlined, muted pause badge with a `⏸` glyph (deliberate pause — Slice 12 decision; it must never read as the amber problem state).
- Interrupted/recovery uses amber and remains visually distinct from sitting-out.

Player cards show:

- Player name.
- Current stack.
- Current street commitment, formatted as `Bet: <amount>`.
- Dealer, blind, folded, all-in, sitting-out, interrupted, or active badges as applicable.
- Optional stack bar relative to starting stack or session peak.

## Street And Pot Center

The center of the table is not a standalone top-of-screen pot display. It is a compact table-center stack containing street placeholders and pots.

Street placeholders:

- Pre-flop: five empty or dashed card placeholder slots with no filled community cards.
- Flop: three filled placeholders and two dashed slots.
- Turn: four filled placeholders and one dashed slot.
- River/showdown: five filled placeholders.
- Placeholders only indicate street count. They do not show card values.

Pot stack:

- Main pot appears first and largest, labeled `Main Pot`.
- Pot values are live totals that include chips committed on the current street.
- Side pots appear below in creation/display order, labeled `Side Pot 1`, `Side Pot 2`, and so on.
- Each pot displays amount and eligible player names where space allows.
- The table-play Stitch screen shows `Main Pot 1,200` with eligible names and `Side Pot 1 450`; preserve that pattern.
- Pot chips must remain visually subordinate to turn/action controls; do not let side-pot cards crowd player seats.

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
- Rebuy or add chips.
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
- Split mode labels `Split Pot` and shows exact chip amount inputs.
- Split mode shows live remaining-unallocated feedback: `Remaining Unallocated:` or `Remaining:`.
- Split mode includes `Cancel` and `Confirm Split`.
- `Next Hand` remains disabled until every pot is settled.

Settlement interactions require confirmation before chip movement is committed.

## Cash-Out And History

Stitch does not yet provide a complete cash-out/history screen. Implement it using the same Deep Stack Logic patterns:

- Charcoal full-screen surface.
- Dense table-style rows instead of decorative cards.
- Per-player buy-ins, rebuys, final chips, cash-out value, and net result.
- Editable minimized transfers.
- Explicit rounding remainder when present.
- Finished-game history derives from local player profiles and finished-game summaries.

## Host And Desktop Surfaces

Stitch does not provide desktop screens. Host and laptop surfaces, including the share screen, table overview, history, and stats, reuse the same Deep Stack Logic patterns:

- Same color tokens, Inter typography, and badge language as the mobile screens.
- Dense table-style rows and wider multi-column layouts instead of new decorative components.
- The share screen may enlarge the QR code and full URL for across-the-table scanning.
- No new Stitch screens are required for the MVP.

## Accessibility And Contrast

- Emerald buttons use `on-primary` or `on-primary-container`; white text on emerald is not allowed.
- Icon-only controls must have accessible names.
- Status must not be color-only; use badges such as `Locked`, `Folded`, `Reclaim`, `All-In`, and `Your Turn`.
- Button labels must fit at 390px phone width without truncating core action amounts.
- Keep touch targets at least 40px high/wide for action and icon buttons.

## Implementation Notes

- Treat this file as the implementation design contract when Stitch metadata conflicts with generated HTML or older theme text.
- The implementation may use the screen HTML as a visual reference, but must follow `SPEC.md` for behavior.
- Do not copy generated Stitch code directly if it conflicts with the architecture boundaries.
- Use browser-automation E2E to verify phone portrait layout, action-panel fit, settlement flow, and rotate prompt.
