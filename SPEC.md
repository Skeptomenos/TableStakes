# Poker Chip Counter SPEC

Status: Draft
Last updated: 2026-07-08 (console/player surface separation, ADR 0002)

## Purpose

Poker Chip Counter is a local-first phone web app for casual private No Limit Texas Hold'em games. It replaces physical chip counting with a shared table ledger while leaving cards, hand evaluation, and table judgment to the people playing.

The product should feel like a shared table remote: the laptop hosts the authoritative game state, and each player uses a phone in portrait orientation for fast actions, stack visibility, pot settlement, reconnect, and table recovery.

## Product Principles

- Optimize for private hobby games, not casino or online poker-room operation.
- Keep the live hand flow fast enough that it does not disrupt the physical game.
- Track chip conservation, pot eligibility, table order, and audit history reliably.
- Use social correction for most table mistakes because all players are physically present.
- Confirm only destructive, high-value, or structural actions.
- Prefer visible table actions over hidden admin gates during live play.
- Keep cards and hand evaluation outside the app.

## Audience

The primary users are private groups playing poker for fun at a physical table. Stakes can range from small money to meaningful real-money sessions, so accounting must be reliable, auditable, and easy to correct.

## Supported Game

MVP supports No Limit Texas Hold'em only.

A game supports 2 to 10 seated players. A hand requires at least 2 players with chips.

The app tracks:

- Players and seating order.
- Dealer, small blind, and big blind positions.
- Hand number and street.
- Player stacks.
- Per-street commitments.
- Main pot and side pots.
- Folded, all-in, sitting-out, interrupted, and needs-rebuy states.
- Buy-ins, rebuys, cash-out, and settlement suggestions.

The app does not track:

- Cards dealt to players.
- Community-card values.
- Poker hand strength.
- Winner evaluation.
- Poker strategy analytics.
- Tournament clocks or blind schedules.
- Antes, straddles, or bomb pots.

## Device Model

Phone portrait is the authoritative gameplay surface. Core in-hand state and controls must fit in a phone portrait viewport without requiring scrolling during normal play.

Landscape phone gameplay is out of scope for the MVP. Landscape should show a rotate-to-portrait prompt.

The app separates two workflows by route, never by device detection (ADR 0002):

- **Table console (`/console`)** — the table-lifecycle surface, normally the host laptop. Creates the table, configures settings, displays the join QR and code for the whole night, shows who is seated, picks the first dealer, starts the first hand, and offers table overview, history, and stats. `start.sh` opens the console in a browser automatically.
- **Player surface (`/g/<code>`)** — the player-lifecycle surface, normally a phone. Pick or create a profile, claim a seat, confirm the buy-in, play.
- **Player landing (`/`)** — a minimal entry point for anyone who reaches the bare host address: join by code and a tap-to-join list of active tables. No table creation.

Console-primary is not console-exclusive: any connected client can use shared table actions, and the laptop may legitimately claim a seat and play. No surface is hard-blocked by device.

## Game URL And Hosting

The host manually starts one local Node.js server on a laptop. Phones connect over the same LAN by opening a dedicated game URL:

```text
http://<host>:<port>/g/<five-digit-code>
```

The server can host multiple active games at once, keyed by five-digit code. The console manages tables (create, share, overview) and may optimize for one current game; the player landing lists all active tables for joining.

Game code generation must:

- Generate a five-digit code.
- Check uniqueness against SQLite.
- Regenerate on collision.
- Show a clear error if collision attempts are exhausted.

The share surface must show:

- QR code for the full game URL.
- Full local URL.
- Five-digit game code.
- Chosen LAN address.
- Warning when the server is only reachable on localhost.
- Reachability hints when multiple local addresses are available.

The share surface must stay reachable for the whole night, not only during setup (ADR 0002): the console displays it permanently, and seated players can open it from the phone's table-management drawer so late arrivals can scan mid-game.

## Player Identity And Reconnect

Player identity separates reusable local profiles from seats in a specific game.

The host laptop is canonical for:

- Player profiles.
- Game seats.
- Game history.
- Stats.

Phones may store a lightweight reconnect hint, such as the last profile or seat used for a game. Phone hints only preselect host-owned state; they are not authoritative.

The MVP does not require players to see, copy, enter, or manage any reconnect token. A browser may keep a silent local session hint to make automatic reconnect smoother, but that hint cannot unlock a seat that the server considers actively connected elsewhere.

Join flow:

1. Open `/g/<code>` — by scanning the console's QR, a seated player's shared QR, entering the code on the player landing, or tapping the table in the landing's active-tables list.
2. Select an existing local player profile or create a new one.
3. Claim an available or interrupted game seat.
4. Confirm the table's default buy-in (skipped when reclaiming a seat that already has chips).
5. If joining during a hand as a new player, enter active play only between hands.

Seat claiming rules:

- No PIN, password, account login, or user-facing browser-token requirement in the MVP.
- Active connected seats are locked and cannot be claimed by another connection.
- Interrupted seats remain reserved for automatic reconnect or manual recovery.
- Manually released seats become claimable.
- A released seat is not dealt into new hands even if chips remain on it: the chips stay on the table for corrections and cash-out, and dealing resumes when a profile claims the seat again. Interrupted and reserved seats stay dealt in — those players are expected back. (Slice 12; release is the audited "player left for the night" action.)

Disconnect behavior:

- Phone sleep, browser suspension, network change, reload, or tab kill may interrupt realtime transport.
- The app must not actively free a seat through gameplay timeout.
- A socket drop marks the seat interrupted or disconnected while keeping it reserved.
- The app must not auto-fold a player on disconnect in the MVP.
- If an interrupted player is due to act, the table can wait or use visible audited recovery actions.

Manual disaster recovery:

- One visible table action is enough.
- No table vote or PIN is required.
- Actions must write to the audit feed.

## Roles And Permissions

Tables are created from the console (`/console`); no player surface offers creation. Creating a game does not require a profile — when one is supplied it is recorded for audit purposes only and has no special privileges; console-created games record their console origin instead. Selecting a profile never creates or joins a game by itself.

The MVP has no privileged admin role. Every connected player can change game settings and use shared table actions. Every accepted action is logged with the acting profile in the audit feed, and the physically present table socially polices misuse.

Shared setup and settings controls available to all connected players:

- Table settings (console-primary at creation, editable later from any client).
- Starting stack and buy-in defaults.
- Manual blind changes. Applied from the next hand.
- Raise-rule selection. Applied from the next hand.
- Strict-mode toggle. Applied from the next hand.
- Amount step size. Applied immediately.
- First-dealer selection (players seat themselves; there is no host-side seating-order input).
- Player deletion.
- Game reset.
- Finish game and start end-of-night cash-out.

Shared table actions available to all connected players:

- Undo latest visible transaction.
- Correction tools.
- Release or reclaim interrupted seat.
- Mark interrupted player folded.
- Sit out next hand.
- Return from sit-out.
- Rebuy or add chips.
- Award or split pot.
- Cancel hand.

Normal poker actions are locked to the active claimed seat:

- Fold.
- Check.
- Call.
- Bet.
- Raise.
- All-in.

Even in soft mode, a connected non-active player cannot submit another player's normal poker action.

## First-Hand Setup

Setup splits across the two surfaces in three steps (ADR 0002); each step is one compact screen, not a wizard.

**1. Table settings — console, at creation:**

- Currency.
- Default buy-in money.
- Default chip stack.
- Small blind.
- Big blind.
- Strict-mode toggle, default off.

Example buy-in model:

```text
10 EUR = 1000 chips
```

The app derives chip value from the money-to-chip ratio. Chips remain the unit for live hand play.

The raise rule defaults to `Any raise` and is changed later in game settings, not in table settings.

**2. Buy-in confirmation — phone, after claiming a seat:**

Each player explicitly confirms the table's default buy-in ("10 EUR → 1000 chips") in one tap. The amount is fixed — everyone starts with the same money and the same chips; there is no player-side variance and no individual override. Declining means not sitting. A claimed seat without a confirmed buy-in is shown as waiting to buy in and is not dealt in.

**3. First dealer — console-primary, once two or more players have bought in:**

Dealer selection picks the first hand's button only; from then on the button advances automatically between hands (see Blinds). Any connected client may also pick the dealer and start the hand — no admin role.

Advanced setup fields (seat reorder, rename, empty seat insertion) stay out of MVP unless playtesting proves they are required.

## Blinds

Blind amounts stay fixed until a connected player changes them manually in game settings. Manual blind changes are audited and apply from the next hand start.

The MVP has no:

- Automatic blind schedule.
- Blind timer.
- Tournament levels.
- Automatic blind increase.

Dealer button and blind positions advance automatically after every fully settled hand.

Position rules:

- If the next dealer seat is empty, busted, or sitting out, the button skips to the next active player. The MVP does not implement casino dead-button or dead-blind rules.
- Heads-up with 2 players: the dealer posts the small blind and acts first pre-flop; the big blind acts first on every later street.
- A player who owes a blind but has fewer chips posts their entire stack and is all-in for less. Side-pot accounting handles the shortfall.
- A player returning from sit-out is dealt into the next hand with no missed-blind penalty.

## Hand Flow

New hand:

1. Determine dealer, small blind, and big blind.
2. Automatically post blinds.
3. Create the initial pot from forced bets.
4. Set street to pre-flop.
5. Set the correct first active player.

Street flow:

The table center always shows five community-card placeholder slots. The number of filled placeholders indicates the street:

- Pre-flop: 5 empty placeholder slots, 0 filled.
- Flop: 3 filled placeholders, 2 empty slots.
- Turn: 4 filled placeholders, 1 empty slot.
- River: 5 filled placeholders.
- Showdown: 5 filled placeholders plus settlement state.

Check taps are required. They do not move chips, but they let the app advance turn order.

When betting closes for a street, the app highlights `Next street`. A connected player confirms the next street only after the physical cards are dealt.

The app never auto-deals cards.

## Raise Rules

The minimum raise is derived from the game's raise-rule setting in game settings:

- `Any raise`, the default: any amount above the current call amount is a legal raise. The suggested minimum is the call amount plus one chip step.
- `Double`: the raise must make the player's total bet at least double the current bet to match.
- `Standard NLHE`: the raise must increase the current bet by at least the size of the last bet or raise on the street. The minimum opening bet is one big blind.

Raise-rule behavior:

- The selected rule drives the `Min Raise` context, the slider minimum, and suggested amounts.
- Soft mode warns below the rule minimum without blocking. Strict mode blocks below the rule minimum.
- An all-in below the rule minimum does not reopen betting: players who already acted on the street are expected to only call the additional amount or fold. Strict mode blocks a re-raise from those players; soft mode warns.
- Raise-rule changes are audited and apply from the next hand.

## Soft Mode And Strict Mode

Soft mode is the default.

Always-on guardrails:

- Chips cannot disappear or duplicate.
- A player cannot bet more chips than their stack.
- Normal actions must come from the active claimed seat.
- Folded players cannot win later pots.
- All-in players remain eligible only for pots they contributed to.
- Pot settlement cannot allocate more chips than the pot contains.

Soft-mode behavior:

- Bet and raise amounts can be entered loosely.
- The app suggests current minimum or legal amount.
- Below-suggested or below-legal raise amounts show a visible warning.
- The warning does not block commit.
- The slider can stay clamped to the suggested minimum for speed, but exact numeric entry can go below that suggestion in soft mode after showing the warning.

Strict-mode behavior:

- Any connected player can toggle strict No Limit Texas Hold'em enforcement in game settings. The change is audited and applies from the next hand.
- Strict mode can block below-minimum raise amounts under the configured raise rule.
- Strict mode can block unavailable check/call actions.
- Strict mode can enforce tighter turn/action legality.

## Phone Action Panel

The live action panel follows the Deep Stack Logic / Stitch direction.

Required layout:

- Blinds context on the left, such as `Blinds: 50 / 100`.
- Minimum or suggested raise context on the right, such as `Min Raise: 200`.
- One horizontal amount slider.
- Minus icon button on the left of the slider.
- Plus icon button on the right of the slider.
- One central amount display below the slider.
- Sparse action row: `Fold`, `Check` or `Call <amount>`, `Bet` or `Raise`, `All-in`.

Do not include preset quick-chip shortcut buttons in the live action panel, including:

- `+1 BB`.
- `+5 BB`.
- `Half stack`.
- Any other quick raise bank.

This prohibition is scoped to in-hand betting. The rebuy screen's `Full` / `Half` / `Custom` quick-picks (ADR 0002) are a different surface and are required.

Amount behavior:

- Bet and raise amounts are street bet-to TOTALS, not increments: `Raise` to `300` means the player's total commitment on this street becomes 300 (Slice 2 decision; the domain, action panel, and audit events all share this convention).
- Bet and raise amount auto-selects the current minimum or suggested amount for the active turn.
- Slider minimum is the current required minimum or suggested amount.
- Slider maximum is the active player's remaining stack plus their current street commitment — the largest bet-to total the player can reach.
- Plus/minus step defaults to the small blind, with a minimum `1 chip` step.
- Game settings allow step size presets: `5`, `10`, custom chip value, follow small blind, follow big blind.
- The central amount display is tappable for exact numeric chip entry.
- The numeric keypad is hidden until requested.
- In soft mode, exact numeric entry may submit an amount below the slider minimum after a warning. In strict mode, below-minimum entries are blocked.
- `Bet` or `Raise` submits the selected amount directly.
- There is no separate raise amount-selection mode.

Action behavior:

- `Check`, `Call`, standard `Bet`, and standard `Raise` do not require extra confirmation.
- `Fold` requires confirmation.
- `All-in` requires confirmation.
- If the player cannot fully call, the call button becomes `Call All-in <stack>` in the normal call position and requires all-in confirmation.
- If selected bet or raise equals the player's full stack, normalize it to `All-in` and require confirmation.

## Table View

The table visualization is a simple oval or circular layout, not a decorative scene.

The live table must show:

- All seats around the table.
- Player name.
- Stack.
- Current street commitment.
- Dealer marker.
- Small blind marker.
- Big blind marker.
- Active turn.
- Folded state.
- All-in state.
- Sitting-out or paused state.
- Interrupted or disconnected state.
- Main pot and side pots.
- Eligible players for each pot where space allows.
- Community-card placeholders for street state.

The displayed pot total is live: it includes chips committed on the current street. Side-pot breakdown appears once all-in thresholds lock pots.

Sitting out and interrupted are distinct visual states.

The player-card pause icon from Stitch is appropriate for sitting out or paused players.

## Side Pots

Side pots happen when a player goes all-in and at least two other players can continue betting above that all-in amount.

Multiple side pots are possible when multiple players go all-in at different stack levels.

The table center represents pots as an ordered stack:

1. Main pot.
2. Side pot 1.
3. Side pot 2.
4. Later side pots in creation order.

Each pot must track:

- Pot id.
- Label.
- Amount.
- Contributing players whose committed chips fund the pot.
- Eligible winners who can receive the pot.
- Source all-in threshold where applicable.

Contributor and eligible-winner sets are separate. Folded players' committed chips still fund pots, but folded players are removed from eligible-winner sets.

Settlement order follows display order: main pot first, then side pot 1, side pot 2, and onward.

## Hand Settlement

Uncontested win:

- If everyone folds except one live player, the app auto-awards the pot to the last remaining player.
- The action logs an uncontested win.
- The bundled transaction can be undone.

Showdown:

- Any connected player can award or split pots.
- The table socially polices incorrect claims.
- Pot award and split require confirmation.

`Take all eligible pots`:

- Available only when one selected winner is eligible for every unresolved pot.
- Settles those pots in display order as one visible transaction.

Pot-by-pot settlement:

- Required when pot eligibility differs.
- Side pots settle independently.
- Settlement proceeds top-to-bottom as shown on the table.

Split pot (ADR 0003):

- The split view opens with a chop selection: checkboxes over the pot's eligible players.
- Selecting players allocates the pot evenly among them immediately. Integer remainders go one chip at a time to the selected players in seat order starting from the earliest seat after the dealer button (deterministic).
- Adjustments are zero-sum and keep the pot 100% allocated: with exactly two selected players a single slider shifts chips between the two shares; with three or more, per-player increase/decrease steps in the table's amount step pull from or push to the largest other share.
- Exact chip inputs remain available as a fallback, pre-filled with the even split.
- Exact chip amounts are the committed value.
- UI must show live remaining-unallocated chips.
- Commit is allowed only when remaining unallocated amount is zero.

After all pots are settled:

- Hand closes.
- Dealer button advances.
- Blind positions advance.
- Zero-chip players become sitting out or needs rebuy unless they rebuy before the next hand starts.
- A needs-rebuy player is prompted on their own device (ADR 0003): a card offers a one-tap rebuy at exactly the table default (confirmation required), a smaller custom-rebuy action that opens the rebuy screen preselected to that player, and sit out.
- `Next Hand` is disabled with a stated reason whenever fewer than two seated players have chips — the same rule the domain enforces, surfaced before the tap instead of as a rejection after it.

## Undo And Corrections

Undo reverses the latest visible transaction, not necessarily one low-level event.

Examples of bundled transactions:

- Final fold plus auto-award.
- Auto-award plus hand advance.
- Pot split across multiple winners.
- `Take all eligible pots`.

Undo behavior:

- Requires confirmation.
- Shows what will be reversed.
- Writes an audit entry.
- Restores the previous visible game state.

Older mistakes use correction tools, not repeated undo.

Corrections are zero-sum: they move chips between stacks and pots but never change the total chips in play. Chips enter play only through buy-ins and rebuys and leave only through cash-out. Every correction writes an audit entry with the acting profile.

Correction examples:

- Correct player stack.
- Correct pot amount.
- Restore folded player.
- Set active player.
- Release or reclaim interrupted seat.

Cancel hand:

- Available to any connected player with confirmation.
- Returns every commitment in the current hand, including posted blinds, to player stacks.
- Voids the hand: no pots are awarded and the dealer button does not advance.
- Writes an audit entry. The next hand re-posts blinds from the same positions.

Game reset:

- Available to any connected player with confirmation.
- Returns the game to first-hand setup.
- Resets every player's stack to their total purchased chips from buy-ins plus rebuys.
- Keeps profiles, buy-in records, and the audit/event history.

## Confirmations

Routine actions should stay fast.

No extra confirmation:

- Check.
- Call.
- Standard bet.
- Standard raise.

Confirmation required:

- Fold.
- All-in.
- Pot award.
- Pot split.
- Rebuy or add chips.
- Undo.
- Correction.
- Reset.
- Delete.
- End-of-night cash-out settlement.

Confirmation copy must state the player, amount, pot, or settlement impact clearly.

## Buy-Ins, Rebuys, And Cash-Out

Money appears only in setup, rebuy, cash-out, and settlement. Live hand play remains chip-first.

Money is tracked in integer cents. Chips are tracked as integers.

Buy-in (ADR 0002):

- Is exactly the table's configured default — money and chips. The domain rejects a first buy-in that differs from the default.
- Is confirmed explicitly by the player after claiming a seat (see First-Hand Setup).
- Records money amount and chips received; defines chip value as a rational ratio.

Rebuy (ADR 0002):

- Any amount above zero up to at most the configured default — never more. Money and chips stay proportional via the table ratio; the domain rejects amounts above the cap.
- The rebuy screen offers Full / Half / Custom amounts.
- Adds money and chips to a player.
- Writes an audit event.
- Normally happens between hands.
- During active hands, only folded, out-of-hand, or sitting-out players can rebuy.
- Active-hand rebuy chips apply next hand so current-hand eligibility and side pots are not changed.

Corrections remain the audited escape hatch for non-standard table situations: they move chips zero-sum and never create money, so conservation holds.

Zero-chip player:

- Keeps seat, profile, and history.
- Is marked sitting out or needs rebuy after hand settlement.
- Is skipped for blinds and action until rebuy.
- Sees the needs-rebuy prompt card on their own device between hands (ADR 0003); every other player sees a `Needs rebuy` status pill on that player's card.

Any connected player can finish the game and start end-of-night cash-out, with confirmation.

End-of-night cash-out shows:

- Total buy-ins and rebuys per player.
- Final chip stack.
- Cash-out value.
- Net win or loss.
- Editable minimized payment transfers from net losers to net winners.
- Explicit rounding remainder where applicable.

Total cash-out must equal total buy-ins after rounding.

## Persistence And History

Active games must survive:

- Host laptop sleep.
- Browser reload.
- Server restart.
- Phone reconnect.

Storage:

- SQLite.
- One local database file under the app/project data directory.
- Append-only event log for every accepted action.
- Optional snapshots for faster restore.

Commit rule:

- The server persists an accepted action before clients treat it as committed.

Active games retain all events.

Finished games retain:

- Final snapshot.
- Settlement summary.
- Key audit/history events needed for review and stats.

Finished games are not deleted automatically.

## Stats

MVP stats are session-level and derived from already-tracked accounting data.

Included:

- Games played.
- Total buy-ins and rebuys.
- Total cash-out.
- Net win or loss.
- Biggest win and biggest loss per session.
- Average net per game.
- Total hands played, if available from hand counter.
- Per-game settlement summary.

Excluded:

- VPIP.
- PFR.
- Bluff metrics.
- Hand-level strategy analytics.
- Showdown performance analytics.

Stats aggregate by reusable local player profile.

## Design Direction

The chosen visual direction is Deep Stack Logic:

- Dark, low-light-friendly, mobile-first.
- Utilitarian, quiet, and focused.
- Tonal layers instead of casino spectacle.
- Emerald for active/positive actions.
- Amber for warning or sitting-out status.
- Clear status badges.
- Large numeric values for stacks, pots, and selected action amounts.

The UI should not feel like a marketing page, casino game, or decorative poker table. It should feel like a precise local table instrument.

## Stitch Screen Contract

The Stitch project uses Deep Stack Logic as the active design direction. `DESIGN.md` captures the local implementation contract derived from the Stitch mobile screens.

Required MVP screens (ADR 0002 surfaces):

- Table console: creation/settings, permanent share card, seat overview, first-dealer pick.
- Player landing: join by code, active-tables list.
- Join and seat selection.
- Buy-in confirmation.
- Live table play.
- Table action drawer or sheet (including the mid-game share card).
- Hand settlement.
- Rebuy or add chips.
- End-of-night cash-out.

Join and seat selection must show:

- Full local URL and five-digit code fallback.
- Local profile selection or profile creation (selection has no side effects).
- Available seats as claimable.
- Active connected seats as locked.
- Interrupted seats as reserved or recoverable.
- No PIN, password, or account-login surface.

The console's table-settings form and the buy-in confirmation screen must show the money-to-chip relationship directly, for example `10 EUR = 1000 chips`, and must not label chips as the currency. Dealer selection must behave as a single selected dealer button, not as independent toggles that imply multiple dealers. Strict mode defaults off.

Game settings must include amount step size controls:

- `5`.
- `10`.
- Custom chip value.
- Follow small blind.
- Follow big blind.

Game settings must include raise-rule selection: `Any raise` as default, `Double`, and `Standard NLHE`.

Live table play must preserve the sparse Deep Stack Logic action panel:

- No preset quick-chip button bank.
- Direct `Check` or `Call <amount>` primary action.
- Slider plus minus/plus controls.
- Tappable central amount display.
- `Bet` or `Raise` submits the selected amount directly.
- Table actions stay behind a compact manage control.

Settlement must make winner selection explicit before showing `Take all eligible pots`. The button is available only for the selected winner and only when that winner can receive every unresolved pot. Split mode must use exact chip inputs, live remaining-unallocated feedback, and confirmation before commit. `Next hand` stays disabled until every pot is fully settled.

## MVP Acceptance Criteria

- Host can start the local server manually; the console creates the table and shares one game URL.
- Console shows QR code, full URL, five-digit code, LAN address, and localhost warning when needed — for the whole night, not only during setup.
- No player surface (landing or game route) can create a table; selecting a profile never creates a game.
- Players can join by selecting or creating a local profile, claiming a seat, and confirming the default buy-in.
- A first buy-in that differs from the table default is rejected; a rebuy above the default is rejected.
- Active seats are locked from other claim attempts.
- Interrupted seats remain reserved and recoverable.
- Each setup step (table settings, buy-in confirmation, dealer pick) fits one compact screen.
- A complete hand can run from blinds through settlement.
- Check taps advance turn order.
- Street closure highlights `Next street`.
- Phone portrait live controls do not require core in-hand scrolling.
- Landscape shows rotate prompt.
- Action panel has no quick-chip button bank.
- Slider min/max and step behavior match this spec.
- Short-stack calls show `Call All-in <stack>`.
- Full-stack bet/raise normalizes to confirmed all-in.
- Uncontested hands auto-award the pot.
- Side pots are shown and settled in order.
- Split pots require exact allocations and show remaining chips.
- Undo reverses latest visible transaction with confirmation.
- Rebuys protect active-hand pot eligibility.
- A heads-up hand with 2 players posts blinds and orders action correctly.
- The dealer button skips busted, empty, or sitting-out seats.
- A short-stacked blind posts all-in for less and side pots stay correct.
- Raise-rule setting offers `Any raise` as default, `Double`, and `Standard NLHE`, applying from the next hand.
- Cancel hand refunds all commitments including blinds without advancing the button.
- Game reset returns to setup with stacks equal to purchased chips.
- Corrections are zero-sum and audited with the acting profile.
- End-of-night cash-out computes editable minimized transfers.
- Active games restore from SQLite after restart.
- Finished games remain available for history and stats.
