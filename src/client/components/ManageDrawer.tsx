import { useEffect, useState } from 'react'

import type { GamePlayer, GameSnapshot } from '../../shared/schema/snapshot'
import { bySeatOrder } from '../view-helpers'
import { ConfirmSheet } from './ConfirmSheet'
import { ShareCard } from './ShareCard'

export interface UndoPreview {
  transactionId: string
  label: string
  events: string[]
  undoable: boolean
  reason?: string
}

export interface DrawerServerInfo {
  addresses: string[]
  localhostOnly: boolean
}

export interface ManageDrawerProps {
  snapshot: GameSnapshot
  mySeat: number | null
  onCommand(command: unknown): void
  onClose(): void
  /** Fetches what confirming undo would reverse; null = nothing to undo. */
  loadUndoPreview(): Promise<UndoPreview | null>
  /** LAN reachability for the mid-game share view (SPEC.md: reachable all night). */
  loadServerInfo(): Promise<DrawerServerInfo>
  /**
   * Deep-link support (ADR 0003): the needs-rebuy prompt card's "Custom
   * rebuy" opens the drawer directly on the rebuy view instead of the
   * menu. Omitted/undefined preserves today's default menu-first behavior.
   */
  initialView?: View
  /** Preselects this player in the rebuy view when initialView is 'rebuy'. */
  initialRebuyPlayerId?: string
}

type CorrectionTargetValue = `player:${string}` | `pot:${string}`

interface CorrectionDraft {
  reason: string
  amount: number
  from: CorrectionTargetValue
  to: CorrectionTargetValue
  fromLabel: string
  toLabel: string
}

type Confirming =
  | { kind: 'undo'; preview: UndoPreview }
  | { kind: 'cancel-hand' }
  | { kind: 'reset' }
  | { kind: 'finish' }
  | { kind: 'mark-folded'; player: GamePlayer }
  | { kind: 'restore'; player: GamePlayer }
  | { kind: 'set-active'; player: GamePlayer }
  | { kind: 'release'; player: GamePlayer }
  | { kind: 'rebuy'; player: GamePlayer; chips: number; cents: number; currency: string }
  | { kind: 'correction'; draft: CorrectionDraft }
  | null

type View = 'menu' | 'rebuy' | 'correction' | 'settings' | 'share'

/**
 * The shared table-management sheet (SPEC.md Shared table actions): every
 * connected player can recover interrupted seats, undo the latest visible
 * transaction, correct table state, manage sit-out/return and rebuys, and
 * change game settings. Every action lands in the audit feed; destructive
 * ones confirm first with copy that states player, amount, or impact.
 */
export function ManageDrawer({
  snapshot,
  mySeat,
  onCommand,
  onClose,
  loadUndoPreview,
  loadServerInfo,
  initialView,
  initialRebuyPlayerId,
}: ManageDrawerProps) {
  const [view, setView] = useState<View>(initialView ?? 'menu')
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [undoNote, setUndoNote] = useState<string | null>(null)
  const [serverInfo, setServerInfo] = useState<DrawerServerInfo | null>(null)

  useEffect(() => {
    if (view !== 'share') return
    loadServerInfo()
      .then(setServerInfo)
      .catch(() => setServerInfo(null))
    // Reloaded each time the share view opens: LAN addresses can change
    // over a long night (Wi-Fi reconnects), and this is a cheap fetch.
  }, [view, loadServerInfo])

  const status = snapshot.game.status
  const hand = snapshot.hand
  const inHand = status === 'in-hand'
  const players = bySeatOrder(snapshot.players)
  const me = players.find((p) => p.seatIndex === mySeat) ?? null

  const blocking =
    inHand && hand?.activeSeat !== null
      ? (players.find(
          (p) =>
            p.seatIndex === hand?.activeSeat && p.connection !== 'connected',
        ) ?? null)
      : null
  const folded = inHand ? players.filter((p) => p.handStatus === 'folded') : []
  const dealtIn = new Set(hand?.commitments.map((c) => c.seatIndex) ?? [])
  const turnCandidates = inHand
    ? players.filter(
        (p) =>
          dealtIn.has(p.seatIndex) &&
          p.seatIndex !== hand?.activeSeat &&
          (p.handStatus === 'waiting' || p.handStatus === 'active'),
      )
    : []
  const releasable = players.filter(
    (p) => p.connection === 'interrupted' || p.connection === 'reserved',
  )
  const sittingOut =
    me !== null && (me.sitOutNextHand || me.handStatus === 'sitting-out')

  const commit = (command: unknown) => {
    onCommand(command)
    setConfirming(null)
    onClose()
  }

  const openUndo = async () => {
    setUndoNote(null)
    const preview = await loadUndoPreview()
    if (!preview) {
      setUndoNote('Nothing to undo.')
      return
    }
    // Never offer a confirm the server must refuse (PR #182 review):
    // explain the non-undoable transaction in place instead.
    if (!preview.undoable) {
      setUndoNote(
        `Can't undo "${preview.label}": ${preview.reason ?? 'not undoable'}.`,
      )
      return
    }
    setConfirming({ kind: 'undo', preview })
  }

  return (
    <div className="manage-drawer" role="dialog" aria-label="Manage table">
      <div className="manage-drawer__card">
        <header className="manage-drawer__header">
          <h3 className="manage-drawer__title">
            {view === 'menu' ? 'Manage Table' : null}
            {view === 'rebuy' ? 'Rebuy / Add Chips' : null}
            {view === 'correction' ? 'Move Chips' : null}
            {view === 'settings' ? 'Game Settings' : null}
            {view === 'share' ? 'Share this table' : null}
          </h3>
          {view === 'menu' ? (
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
          ) : (
            <button type="button" className="button" onClick={() => setView('menu')}>
              Back
            </button>
          )}
        </header>

        {view === 'menu' ? (
          <div className="manage-drawer__menu">
            <p className="manage-drawer__section">Recovery</p>
            <button
              type="button"
              className="button manage-drawer__action"
              onClick={() => void openUndo()}
            >
              Undo Last Action
            </button>
            {undoNote ? <p className="manage-drawer__note">{undoNote}</p> : null}
            {inHand ? (
              <button
                type="button"
                className="button manage-drawer__action"
                onClick={() => setConfirming({ kind: 'cancel-hand' })}
              >
                Cancel Hand
              </button>
            ) : null}
            {blocking ? (
              <button
                type="button"
                className="button manage-drawer__action"
                onClick={() => setConfirming({ kind: 'mark-folded', player: blocking })}
              >
                Mark {blocking.name} Folded
              </button>
            ) : null}
            {folded.map((player) => (
              <button
                key={player.id}
                type="button"
                className="button manage-drawer__action"
                onClick={() => setConfirming({ kind: 'restore', player })}
              >
                Restore {player.name}
              </button>
            ))}
            {turnCandidates.map((player) => (
              <button
                key={player.id}
                type="button"
                className="button manage-drawer__action"
                onClick={() => setConfirming({ kind: 'set-active', player })}
              >
                Turn to {player.name}
              </button>
            ))}
            {releasable.map((player) => (
              <button
                key={player.id}
                type="button"
                className="button manage-drawer__action"
                onClick={() => setConfirming({ kind: 'release', player })}
              >
                Release {player.name}
              </button>
            ))}

            <p className="manage-drawer__section">Players</p>
            {me ? (
              sittingOut ? (
                <button
                  type="button"
                  className="button manage-drawer__action"
                  onClick={() => commit({ _tag: 'return-from-sit-out' })}
                >
                  Return Next Hand
                </button>
              ) : (
                <button
                  type="button"
                  className="button manage-drawer__action"
                  onClick={() => commit({ _tag: 'sit-out' })}
                >
                  Sit Out Next Hand
                </button>
              )
            ) : null}
            <button
              type="button"
              className="button manage-drawer__action"
              onClick={() => setView('rebuy')}
            >
              Rebuy / Add Chips
            </button>
            <button
              type="button"
              className="button manage-drawer__action"
              onClick={() => setView('correction')}
            >
              Move Chips (Correction)
            </button>

            <p className="manage-drawer__section">Table</p>
            <button
              type="button"
              className="button manage-drawer__action"
              onClick={() => setView('share')}
            >
              Share this table
            </button>
            <button
              type="button"
              className="button manage-drawer__action"
              onClick={() => setView('settings')}
            >
              Settings
            </button>
            {status === 'between-hands' ? (
              <button
                type="button"
                className="button manage-drawer__action"
                onClick={() => setConfirming({ kind: 'finish' })}
              >
                Finish Game
              </button>
            ) : null}
            <button
              type="button"
              className="button manage-drawer__action"
              onClick={() => setConfirming({ kind: 'reset' })}
            >
              Reset Game
            </button>
          </div>
        ) : null}

        {view === 'rebuy' ? (
          <RebuyForm
            snapshot={snapshot}
            initialPlayerId={initialRebuyPlayerId}
            onReview={(player, chips, cents) =>
              setConfirming({
                kind: 'rebuy',
                player,
                chips,
                cents,
                currency: snapshot.game.settings.currency,
              })
            }
          />
        ) : null}

        {view === 'correction' ? (
          <CorrectionForm
            snapshot={snapshot}
            onReview={(draft) => setConfirming({ kind: 'correction', draft })}
          />
        ) : null}

        {view === 'settings' ? (
          <SettingsForm snapshot={snapshot} onCommand={onCommand} />
        ) : null}

        {view === 'share' ? (
          <ShareCard
            code={snapshot.game.code}
            port={window.location.port || '80'}
            addresses={serverInfo?.addresses ?? []}
          />
        ) : null}
      </div>

      {renderConfirm(confirming, commit, () => setConfirming(null))}
    </div>
  )
}

function renderConfirm(
  confirming: Confirming,
  commit: (command: unknown) => void,
  cancel: () => void,
) {
  if (!confirming) return null
  switch (confirming.kind) {
    case 'undo':
      return (
        <ConfirmSheet
          title="Undo?"
          detail={`Reverses: ${confirming.preview.label} (${confirming.preview.events.join(', ')})`}
          confirmLabel="Confirm Undo"
          danger
          onCancel={cancel}
          onConfirm={() =>
            commit({
              _tag: 'undo',
              expectedTransactionId: confirming.preview.transactionId,
            })
          }
        />
      )
    case 'cancel-hand':
      return (
        <ConfirmSheet
          title="Cancel this hand?"
          detail="Every chip committed this hand, blinds included, returns to the stacks. No pots are awarded and the button does not move."
          confirmLabel="Confirm Cancel"
          danger
          onCancel={cancel}
          onConfirm={() => commit({ _tag: 'cancel-hand' })}
        />
      )
    case 'finish':
      return (
        <ConfirmSheet
          title="Finish the game?"
          detail="Ends the night and opens the end-of-night cash-out with buy-ins, final stacks, and payment suggestions."
          confirmLabel="Confirm Finish"
          danger
          onCancel={cancel}
          onConfirm={() => commit({ _tag: 'finish-game' })}
        />
      )
    case 'reset':
      return (
        <ConfirmSheet
          title="Reset game?"
          detail="Back to setup. Every stack becomes that player's total purchased chips. Buy-in records and history stay."
          confirmLabel="Confirm Reset"
          danger
          onCancel={cancel}
          onConfirm={() => commit({ _tag: 'reset-game' })}
        />
      )
    case 'mark-folded':
      return (
        <ConfirmSheet
          title={`Fold ${confirming.player.name}?`}
          detail={`${confirming.player.name} is disconnected and due to act. This folds their hand — it cannot be undone by reconnecting.`}
          confirmLabel="Confirm Fold"
          danger
          onCancel={cancel}
          onConfirm={() =>
            commit({
              _tag: 'mark-interrupted-folded',
              seatIndex: confirming.player.seatIndex,
            })
          }
        />
      )
    case 'restore':
      return (
        <ConfirmSheet
          title={`Restore ${confirming.player.name}?`}
          detail={`${confirming.player.name} returns to the hand and must act again this street.`}
          confirmLabel="Confirm Restore"
          onCancel={cancel}
          onConfirm={() =>
            commit({
              _tag: 'restore-folded-player',
              seatIndex: confirming.player.seatIndex,
            })
          }
        />
      )
    case 'set-active':
      return (
        <ConfirmSheet
          title={`Give the turn to ${confirming.player.name}?`}
          detail="Moves the turn pointer. Use this when the table agrees the wrong player is up."
          confirmLabel="Confirm Turn"
          onCancel={cancel}
          onConfirm={() =>
            commit({
              _tag: 'set-active-player',
              seatIndex: confirming.player.seatIndex,
            })
          }
        />
      )
    case 'release':
      return (
        <ConfirmSheet
          title={`Release ${confirming.player.name}'s seat?`}
          detail="The seat stops being reserved and anyone can claim it."
          confirmLabel="Confirm Release"
          danger
          onCancel={cancel}
          onConfirm={() =>
            commit({ _tag: 'release-seat', seatIndex: confirming.player.seatIndex })
          }
        />
      )
    case 'rebuy':
      return (
        <ConfirmSheet
          title={`Rebuy for ${confirming.player.name}?`}
          detail={`${confirming.player.name} receives ${confirming.chips} chips for ${(confirming.cents / 100).toFixed(2)} ${confirming.currency}.`}
          confirmLabel="Confirm Rebuy"
          onCancel={cancel}
          onConfirm={() =>
            commit({
              _tag: 'record-rebuy',
              playerId: confirming.player.id,
              money: { currency: confirming.currency, cents: confirming.cents },
              chips: confirming.chips,
            })
          }
        />
      )
    case 'correction':
      return (
        <ConfirmSheet
          title="Apply correction?"
          detail={`Move ${confirming.draft.amount} chips from ${confirming.draft.fromLabel} to ${confirming.draft.toLabel} — "${confirming.draft.reason}"`}
          confirmLabel="Confirm Correction"
          danger
          onCancel={cancel}
          onConfirm={() =>
            commit({
              _tag: 'apply-correction',
              reason: confirming.draft.reason,
              moves: [
                { target: parseTarget(confirming.draft.from), delta: -confirming.draft.amount },
                { target: parseTarget(confirming.draft.to), delta: confirming.draft.amount },
              ],
            })
          }
        />
      )
  }
}

function parseTarget(value: CorrectionTargetValue) {
  const [kind, id] = value.split(':', 2) as ['player' | 'pot', string]
  return kind === 'player'
    ? { kind: 'player-stack' as const, playerId: id }
    : { kind: 'pot' as const, potId: id }
}

type RebuyPick = 'full' | 'half' | 'custom'

/**
 * Rebuy amounts (ADR 0002, Slice 4): capped at the table default client-
 * side too, mirroring the domain cap (Slice 2) — the field can never hold
 * an above-cap value the player could submit. Full/Half/Custom quick-picks
 * replace free-form money entry; money is always DERIVED from the chip
 * ratio, never typed directly (SPEC.md: chips are never labeled as the
 * currency).
 */
function RebuyForm({
  snapshot,
  initialPlayerId,
  onReview,
}: {
  snapshot: GameSnapshot
  initialPlayerId?: string
  onReview(player: GamePlayer, chips: number, cents: number): void
}) {
  const players = bySeatOrder(snapshot.players)
  const settings = snapshot.game.settings
  const cap = settings.defaultStack
  const ratio = cap > 0 ? settings.defaultBuyInCents / cap : 1
  // Half rounds to the nearest chip (Decision Log, Slice 4): the default
  // stack is not guaranteed even, and floor-only would under-credit a
  // player by up to one chip for no reason.
  const halfChips = Math.round(cap / 2)

  const [playerId, setPlayerId] = useState(initialPlayerId ?? players[0]?.id ?? '')
  const [pick, setPick] = useState<RebuyPick>('full')
  const [customChips, setCustomChips] = useState<number>(cap)
  const player = players.find((p) => p.id === playerId)

  const chips =
    pick === 'full' ? cap : pick === 'half' ? halfChips : customChips
  const cents = Math.round(chips * ratio)
  const invalid = chips <= 0 || chips > cap || cents <= 0

  return (
    <div className="manage-drawer__form">
      <label className="field">
        <span>Player</span>
        <select
          className="input"
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
        >
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="manage-drawer__quick-picks" role="group" aria-label="Rebuy amount">
        <button
          type="button"
          className={pick === 'full' ? 'button button--primary' : 'button'}
          onClick={() => setPick('full')}
        >
          Full
        </button>
        <button
          type="button"
          className={pick === 'half' ? 'button button--primary' : 'button'}
          onClick={() => setPick('half')}
        >
          Half
        </button>
        <button
          type="button"
          className={pick === 'custom' ? 'button button--primary' : 'button'}
          onClick={() => setPick('custom')}
        >
          Custom
        </button>
      </div>

      {pick === 'custom' ? (
        <label className="field">
          <span>Chips (max {cap})</span>
          <input
            className="input"
            type="number"
            min={1}
            max={cap}
            value={customChips}
            onChange={(e) => {
              const value = Number(e.target.value)
              if (Number.isFinite(value)) {
                // Clamped, not merely validated: the field itself never
                // holds an above-cap value (ADR 0002 rebuy cap).
                setCustomChips(Math.max(0, Math.min(cap, Math.round(value))))
              }
            }}
          />
        </label>
      ) : (
        <p className="setup-ratio">{chips} chips</p>
      )}

      <p className="manage-drawer__note">
        {(cents / 100).toFixed(2)} {settings.currency} → {chips} chips
      </p>
      {invalid ? (
        <p className="manage-drawer__reason">
          Amount must be between 1 and {cap} chips.
        </p>
      ) : null}

      <button
        type="button"
        className="button button--primary"
        disabled={!player || invalid}
        onClick={() => player && onReview(player, chips, cents)}
      >
        Review Rebuy
      </button>
    </div>
  )
}

function CorrectionForm({
  snapshot,
  onReview,
}: {
  snapshot: GameSnapshot
  onReview(draft: CorrectionDraft): void
}) {
  const players = bySeatOrder(snapshot.players)
  const targets: { value: CorrectionTargetValue; label: string }[] = [
    ...players.map((p) => ({
      value: `player:${p.id}` as const,
      label: `${p.name} (stack)`,
    })),
    ...snapshot.pots.map((pot) => ({
      value: `pot:${pot.id}` as const,
      label: pot.label,
    })),
  ]
  const [from, setFrom] = useState<CorrectionTargetValue>(
    targets[0]?.value ?? 'player:none',
  )
  const [to, setTo] = useState<CorrectionTargetValue>(
    targets[1]?.value ?? 'player:none',
  )
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  const labelFor = (value: string) =>
    targets.find((t) => t.value === value)?.label ?? value

  return (
    <div className="manage-drawer__form">
      <label className="field">
        <span>From</span>
        <select
          className="input"
          value={from}
          onChange={(e) => setFrom(e.target.value as CorrectionTargetValue)}
        >
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>To</span>
        <select
          className="input"
          value={to}
          onChange={(e) => setTo(e.target.value as CorrectionTargetValue)}
        >
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Amount</span>
        <input
          className="input"
          type="number"
          min={1}
          value={amount}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (Number.isFinite(value)) setAmount(value)
          }}
        />
      </label>
      <label className="field">
        <span>Reason</span>
        <input
          className="input"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="button button--primary"
        disabled={from === to || amount <= 0 || reason.trim().length === 0}
        onClick={() =>
          onReview({
            reason: reason.trim(),
            amount,
            from,
            to,
            fromLabel: labelFor(from),
            toLabel: labelFor(to),
          })
        }
      >
        Review Correction
      </button>
    </div>
  )
}

function SettingsForm({
  snapshot,
  onCommand,
}: {
  snapshot: GameSnapshot
  onCommand(command: unknown): void
}) {
  const settings = snapshot.game.settings
  const pending = snapshot.game.pendingSettings
  const [smallBlind, setSmallBlind] = useState(
    (pending ?? settings).smallBlind as number,
  )
  const [bigBlind, setBigBlind] = useState(
    (pending ?? settings).bigBlind as number,
  )
  const midHand =
    snapshot.game.status === 'in-hand' || snapshot.game.status === 'showdown'

  return (
    <div className="manage-drawer__form">
      {midHand ? (
        <p className="manage-drawer__note">
          Blind, rule, and strict-mode changes apply from the next hand.
        </p>
      ) : null}
      <label className="field">
        <span>Small blind</span>
        <input
          className="input"
          type="number"
          min={1}
          value={smallBlind}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (Number.isFinite(value)) setSmallBlind(value)
          }}
        />
      </label>
      <label className="field">
        <span>Big blind</span>
        <input
          className="input"
          type="number"
          min={1}
          value={bigBlind}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (Number.isFinite(value)) setBigBlind(value)
          }}
        />
      </label>
      <button
        type="button"
        className="button button--primary"
        disabled={smallBlind <= 0 || bigBlind <= 0}
        onClick={() => onCommand({ _tag: 'update-blinds', smallBlind, bigBlind })}
      >
        Apply Blinds
      </button>
      <label className="field field--row">
        <input
          type="checkbox"
          checked={(pending ?? settings).strictMode}
          onChange={(e) =>
            onCommand({ _tag: 'update-strict-mode', enabled: e.target.checked })
          }
        />
        <span>Strict mode</span>
      </label>
      <label className="field">
        <span>Raise rule</span>
        <select
          className="input"
          value={(pending ?? settings).raiseRule}
          onChange={(e) =>
            onCommand({ _tag: 'update-raise-rule', rule: e.target.value })
          }
        >
          <option value="any">Any raise</option>
          <option value="double">Double the bet</option>
          <option value="standard">Standard (last raise size)</option>
        </select>
      </label>
      <label className="field">
        <span>Amount step</span>
        <select
          className="input"
          value={
            settings.amountStep.kind === 'fixed'
              ? `fixed:${settings.amountStep.chips}`
              : settings.amountStep.kind
          }
          onChange={(e) => {
            const value = e.target.value
            const step = value.startsWith('fixed:')
              ? { kind: 'fixed', chips: Number(value.slice(6)) }
              : { kind: value }
            onCommand({ _tag: 'update-amount-step', step })
          }}
        >
          <option value="follow-small-blind">Follow small blind</option>
          <option value="follow-big-blind">Follow big blind</option>
          <option value="fixed:5">Fixed 5</option>
          <option value="fixed:10">Fixed 10</option>
        </select>
      </label>
    </div>
  )
}
