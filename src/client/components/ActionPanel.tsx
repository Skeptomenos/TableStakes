import { useEffect, useState } from 'react'

import type { GameSnapshot } from '../../shared/schema/snapshot'
import { ConfirmSheet } from './ConfirmSheet'

export interface ActionPanelProps {
  snapshot: GameSnapshot
  mySeat: number
  onCommand(command: unknown): void
}

type Confirmation = 'fold' | 'call-all-in' | 'all-in' | null

/**
 * The sparse Felt & Ledger action panel (SPEC.md Phone Action Panel):
 * blinds/min context, one slider with minus/plus, a tappable exact amount,
 * and the action row. No quick-chip presets. Check/Call/Bet/Raise commit
 * directly; Fold and every all-in variant confirm first. Amounts are
 * street bet-to totals.
 */
export function ActionPanel({ snapshot, mySeat, onCommand }: ActionPanelProps) {
  const hand = snapshot.hand
  const settings = snapshot.game.settings
  const me = snapshot.players.find((p) => p.seatIndex === mySeat)
  const commitment = hand?.commitments.find((c) => c.seatIndex === mySeat)

  const myTurn =
    snapshot.game.status === 'in-hand' &&
    !!hand &&
    !!me &&
    !!commitment &&
    hand.activeSeat === mySeat

  const owed = hand && commitment ? hand.currentBet - commitment.street : 0
  const min = hand?.minRaiseTo ?? 0
  const max = me && commitment ? commitment.street + me.stack : 0
  const step = Math.max(
    1,
    settings.amountStep.kind === 'fixed'
      ? settings.amountStep.chips
      : settings.amountStep.kind === 'follow-big-blind'
        ? settings.bigBlind
        : settings.smallBlind,
  )

  const [amount, setAmount] = useState(Math.min(min, max))
  const [exactOpen, setExactOpen] = useState(false)
  const [confirming, setConfirming] = useState<Confirmation>(null)

  // Auto-select the suggested minimum whenever the turn context changes.
  useEffect(() => {
    setAmount(Math.min(min, max))
    setExactOpen(false)
    setConfirming(null)
  }, [min, max, myTurn, hand?.street])

  const clampHigh = (value: number) => Math.min(value, max)
  // Slider bounds: when a capped short stack's minimum exceeds their reach
  // (min > max), collapse the visual range to the single committable
  // amount — the thumb must never sit on a value the player cannot commit
  // (post-verification F2). The amount state itself is already clamped.
  const sliderMin = Math.min(min, max)
  const sliderMax = Math.max(sliderMin, max)
  const belowMin = amount < min
  const isOpeningBet = (hand?.currentBet ?? 0) === 0
  const aggressionIsAllIn = amount >= max && max > 0
  // An all-in below the rule minimum is ALWAYS legal (SPEC.md Raise Rules):
  // strict mode blocks sub-minimum raises, never a short stack's shove
  // (PR #179 review fix).
  const strictBlocked = settings.strictMode && belowMin && !aggressionIsAllIn
  const shortCall = owed > 0 && !!me && owed >= me.stack

  const submitAggression = () => {
    if (strictBlocked) return
    if (aggressionIsAllIn) {
      setConfirming('all-in')
      return
    }
    onCommand({ _tag: isOpeningBet ? 'bet' : 'raise', amount })
  }

  return (
    <section className="action-panel" aria-label="Actions">
      <div className="action-panel__context">
        <span>
          Blinds: {settings.smallBlind} / {settings.bigBlind}
        </span>
        <span>Min Raise: {min}</span>
      </div>

      <div className="action-panel__slider">
        <button
          type="button"
          className="button action-panel__step"
          aria-label="Decrease amount"
          disabled={!myTurn}
          onClick={() => setAmount((v) => Math.max(min, v - step))}
        >
          −
        </button>
        <input
          type="range"
          aria-label="Amount"
          min={sliderMin}
          max={sliderMax}
          step={step}
          value={Math.max(amount, sliderMin)}
          disabled={!myTurn}
          onChange={(e) => setAmount(clampHigh(Number(e.target.value)))}
        />
        <button
          type="button"
          className="button action-panel__step"
          aria-label="Increase amount"
          disabled={!myTurn}
          onClick={() => setAmount((v) => clampHigh(v + step))}
        >
          +
        </button>
      </div>

      <button
        type="button"
        className="action-panel__amount"
        data-testid="amount-display"
        disabled={!myTurn}
        onClick={() => setExactOpen(true)}
      >
        ✎ {amount}
      </button>
      {exactOpen ? (
        <input
          className="input action-panel__exact"
          type="number"
          aria-label="Exact amount"
          value={amount}
          min={1}
          max={max}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (Number.isFinite(value) && value >= 0) setAmount(clampHigh(value))
          }}
        />
      ) : null}
      {belowMin && !settings.strictMode && !aggressionIsAllIn ? (
        <p className="action-panel__warning">
          {amount} is below the minimum of {min} — the table sees this raise.
        </p>
      ) : null}
      {strictBlocked ? (
        <p className="action-panel__warning">
          Strict mode: minimum is {min}.
        </p>
      ) : null}

      {/* Four equal segments; amounts are mono sub-lines. Claret is
          confirm-sheet-only — resting buttons stay neutral, emerald marks
          the advancing action (design uplift Slice 3). */}
      <div className="action-panel__row">
        <button
          type="button"
          className="button action-panel__action"
          disabled={!myTurn}
          onClick={() => setConfirming('fold')}
        >
          Fold
        </button>
        {owed <= 0 ? (
          <button
            type="button"
            className="button button--primary action-panel__action"
            disabled={!myTurn}
            onClick={() => onCommand({ _tag: 'check' })}
          >
            Check
          </button>
        ) : shortCall ? (
          <button
            type="button"
            className="button button--primary action-panel__action"
            disabled={!myTurn}
            onClick={() => setConfirming('call-all-in')}
          >
            Call All-in <span className="num">{me?.stack}</span>
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary action-panel__action"
            disabled={!myTurn}
            onClick={() => onCommand({ _tag: 'call' })}
          >
            Call <span className="num">{owed}</span>
          </button>
        )}
        <button
          type="button"
          className="button action-panel__action"
          disabled={!myTurn || strictBlocked || max === 0}
          onClick={submitAggression}
        >
          {aggressionIsAllIn ? 'All-In' : isOpeningBet ? 'Bet' : 'Raise'}{' '}
          <span className="num">{amount}</span>
        </button>
        <button
          type="button"
          className="button action-panel__action"
          disabled={!myTurn}
          onClick={() => setConfirming('all-in')}
        >
          All-In
        </button>
      </div>

      {confirming === 'fold' ? (
        <ConfirmSheet
          title="Fold?"
          detail="You give up this hand and any chips already committed."
          confirmLabel="Confirm Fold"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            onCommand({ _tag: 'fold' })
          }}
        />
      ) : null}
      {confirming === 'call-all-in' ? (
        <ConfirmSheet
          title={`Call All-in ${me?.stack}?`}
          detail="Calling puts your whole remaining stack in."
          confirmLabel="Confirm Call All-in"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            onCommand({ _tag: 'call' })
          }}
        />
      ) : null}
      {confirming === 'all-in' ? (
        <ConfirmSheet
          title="All-In?"
          detail={`You put your whole stack in (${max} total).`}
          confirmLabel="Confirm All-In"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            onCommand({ _tag: 'go-all-in' })
          }}
        />
      ) : null}
    </section>
  )
}
