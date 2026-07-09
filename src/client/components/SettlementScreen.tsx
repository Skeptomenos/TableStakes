import { useMemo, useRef, useState } from 'react'

import type { GamePlayer, GameSnapshot, Pot } from '../../shared/schema/snapshot'
import { adjust, evenSplit } from '../split-allocation'
import { bySeatOrder } from '../view-helpers'
import { ConfirmSheet } from './ConfirmSheet'

export interface SettlementScreenProps {
  snapshot: GameSnapshot
  onCommand(command: unknown): void
}

type Confirmation =
  | { kind: 'take-all'; winner: GamePlayer }
  | { kind: 'award'; winner: GamePlayer; pot: Pot }
  | { kind: 'split'; pot: Pot; allocations: { playerId: string; chips: number }[] }
  | null

/**
 * Hand settlement per DESIGN.md: ordered pot sections, explicit winner
 * selection before `Take All Eligible`, pot-by-pot awards restricted to
 * the first unresolved pot, split mode with exact chip inputs and live
 * remaining-unallocated feedback, and `Next Hand` disabled until every
 * pot settles. Any connected player settles; the table polices socially.
 */
export function SettlementScreen({ snapshot, onCommand }: SettlementScreenProps) {
  const pots = snapshot.pots
  const firstPot = pots[0] ?? null
  const total = pots.reduce((sum, pot) => sum + pot.amount, 0)
  const dealerSeat = snapshot.hand?.dealerSeat ?? snapshot.game.dealerSeat ?? 0
  const step = Math.max(
    1,
    snapshot.game.settings.amountStep.kind === 'fixed'
      ? snapshot.game.settings.amountStep.chips
      : snapshot.game.settings.amountStep.kind === 'follow-big-blind'
        ? snapshot.game.settings.bigBlind
        : snapshot.game.settings.smallBlind,
  )

  const [winnerId, setWinnerId] = useState<string | null>(null)
  const [splitOpen, setSplitOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [allocations, setAllocations] = useState<Record<string, number>>({})
  const [confirming, setConfirming] = useState<Confirmation>(null)

  // Remember every pot label seen for this hand: labels that disappear
  // from the snapshot were settled (settled pots leave the pot stack).
  const seenRef = useRef<{ handId: string | null; labels: Map<string, number> }>({
    handId: null,
    labels: new Map(),
  })
  const handId = snapshot.hand?.id ?? null
  if (seenRef.current.handId !== handId) {
    seenRef.current = { handId, labels: new Map() }
  }
  for (const pot of pots) {
    seenRef.current.labels.set(pot.label, pot.amount)
  }
  const openLabels = new Set(pots.map((p) => p.label))
  const rows = [...seenRef.current.labels.entries()].map(([label, amount]) => ({
    label,
    amount,
    pot: pots.find((p) => p.label === label) ?? null,
    settled: !openLabels.has(label),
  }))

  const eligibleAnywhere = useMemo(() => {
    const ids = new Set(pots.flatMap((pot) => [...pot.eligiblePlayerIds]))
    return bySeatOrder(snapshot.players).filter((p) => ids.has(p.id))
  }, [pots, snapshot.players])

  const winner = eligibleAnywhere.find((p) => p.id === winnerId) ?? null
  const winnerEligibleForAll =
    winner !== null &&
    pots.length > 0 &&
    pots.every((pot) => pot.eligiblePlayerIds.some((id) => id === winner.id))
  const winnerEligibleForFirst =
    winner !== null &&
    firstPot !== null &&
    firstPot.eligiblePlayerIds.some((id) => id === winner.id)

  const nameFor = (id: string) =>
    snapshot.players.find((p) => p.id === id)?.name ?? id
  const potsFor = (playerId: string) =>
    pots
      .filter((pot) => pot.eligiblePlayerIds.some((id) => id === playerId))
      .map((pot) => pot.label)
      .join(', ')

  const splitPlayers = firstPot
    ? bySeatOrder(
        snapshot.players.filter((p) =>
          firstPot.eligiblePlayerIds.some((id) => id === p.id),
        ),
      )
    : []
  const selectedPlayers = splitPlayers.filter((p) => selectedIds.has(p.id))
  const allocated = selectedPlayers.reduce(
    (sum, p) => sum + (allocations[p.id] ?? 0),
    0,
  )
  const remaining = (firstPot?.amount ?? 0) - allocated

  const toggleSplitPlayer = (playerId: string) => {
    if (!firstPot) return
    const nextSelected = new Set(selectedIds)
    if (nextSelected.has(playerId)) nextSelected.delete(playerId)
    else nextSelected.add(playerId)
    setSelectedIds(nextSelected)
    const seats = splitPlayers
      .filter((p) => nextSelected.has(p.id))
      .map((p) => ({ playerId: p.id, seatIndex: p.seatIndex }))
    // Re-split evenly on every selection change (ADR 0003): shares always
    // reflect the CURRENT selection, never a stale manual edit.
    setAllocations(evenSplit(firstPot.amount, seats, dealerSeat))
  }

  const adjustSplit = (playerId: string, delta: number) => {
    setAllocations((prev) => adjust(prev, playerId, delta, step))
  }

  const setExactAllocation = (playerId: string, value: number) => {
    const clamped = Number.isFinite(value) && value >= 0 ? value : 0
    setAllocations((prev) => ({ ...prev, [playerId]: clamped }))
  }

  const submitSplit = () => {
    if (!firstPot || remaining !== 0 || selectedPlayers.length === 0) return
    // The split-pot command requires every allocation's chips > 0
    // (schema): a selected player manually adjusted down to exactly 0
    // simply sends nothing, same as today's zero-amount behavior.
    const entries = selectedPlayers
      .filter((p) => (allocations[p.id] ?? 0) > 0)
      .map((p) => ({ playerId: p.id, chips: allocations[p.id]! }))
    setConfirming({ kind: 'split', pot: firstPot, allocations: entries })
  }

  const closeSplit = () => {
    setSplitOpen(false)
    setSelectedIds(new Set())
    setAllocations({})
  }

  return (
    <div className="settlement stack">
      <h2 className="route-title">Hand Settlement</h2>
      <p className="settlement__total">Total Pot Size {total}</p>

      <section className="card" aria-label="Select winner">
        <h3 className="card__title">Select winner</h3>
        {eligibleAnywhere.map((player) => (
          <label key={player.id} className="settlement__winner-row">
            <input
              type="radio"
              name="winner"
              checked={winnerId === player.id}
              onChange={() => setWinnerId(player.id)}
            />
            <span className="settlement__winner-name">{player.name}</span>
            <span className="settlement__winner-eligibility">
              Eligible: {potsFor(player.id)}
            </span>
          </label>
        ))}
        {winner && winnerEligibleForAll ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => setConfirming({ kind: 'take-all', winner })}
          >
            Take All Eligible
          </button>
        ) : null}
      </section>

      {rows.map((row) => (
        <section key={row.label} className="card settlement__pot" aria-label={row.label}>
          <div className="settlement__pot-head">
            <span className="settlement__pot-label">{row.label}</span>
            <span className="settlement__pot-amount">{row.amount}</span>
            {row.settled ? <span className="badge badge--muted">Settled</span> : null}
          </div>
          {row.pot ? (
            <p className="settlement__eligible">
              Eligible: {row.pot.eligiblePlayerIds.map(nameFor).join(', ')}
            </p>
          ) : null}
          {row.pot && firstPot && row.pot.id === firstPot.id && !splitOpen ? (
            <div className="settlement__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={!winnerEligibleForFirst}
                onClick={() =>
                  winner && setConfirming({ kind: 'award', winner, pot: firstPot })
                }
              >
                Award {firstPot.label}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setSelectedIds(new Set())
                  setAllocations({})
                  setSplitOpen(true)
                }}
              >
                Split Pot
              </button>
            </div>
          ) : null}
          {row.pot && firstPot && row.pot.id === firstPot.id && splitOpen ? (
            <div className="settlement__split">
              <div className="settlement__chop-select" role="group" aria-label="Chop selection">
                {splitPlayers.map((player) => (
                  <label key={player.id} className="settlement__chop-row">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(player.id)}
                      onChange={() => toggleSplitPlayer(player.id)}
                    />
                    <span>{player.name}</span>
                  </label>
                ))}
              </div>

              {selectedPlayers.length === 2 ? (
                <SplitSlider
                  players={selectedPlayers}
                  allocations={allocations}
                  potAmount={firstPot.amount}
                  step={step}
                  onChange={setExactAllocation}
                />
              ) : null}
              {selectedPlayers.length >= 3 ? (
                <div className="settlement__chop-steppers">
                  {selectedPlayers.map((player) => (
                    <div key={player.id} className="settlement__chop-stepper">
                      <span className="settlement__chop-stepper-name">{player.name}</span>
                      <button
                        type="button"
                        className="button action-panel__step"
                        aria-label={`Decrease ${player.name}'s share`}
                        onClick={() => adjustSplit(player.id, -1)}
                      >
                        −
                      </button>
                      <span className="settlement__chop-stepper-value num">
                        {allocations[player.id] ?? 0}
                      </span>
                      <button
                        type="button"
                        className="button action-panel__step"
                        aria-label={`Increase ${player.name}'s share`}
                        onClick={() => adjustSplit(player.id, 1)}
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedPlayers.length > 0 ? (
                <div className="settlement__chop-exact">
                  {selectedPlayers.map((player) => (
                    <label key={player.id} className="field">
                      <span>Split for {player.name}</span>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        aria-label={`Split for ${player.name}`}
                        value={allocations[player.id] ?? 0}
                        onChange={(e) =>
                          setExactAllocation(player.id, Number(e.target.value))
                        }
                      />
                    </label>
                  ))}
                </div>
              ) : null}

              <p
                className={
                  remaining === 0
                    ? 'settlement__remaining settlement__remaining--zero'
                    : 'settlement__remaining'
                }
              >
                Remaining: {remaining}
              </p>
              <div className="settlement__actions">
                <button type="button" className="button" onClick={closeSplit}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={remaining !== 0 || selectedPlayers.length === 0}
                  onClick={submitSplit}
                >
                  Confirm Split
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ))}

      <button type="button" className="button" disabled>
        Next Hand
      </button>

      {confirming?.kind === 'take-all' ? (
        <ConfirmSheet
          title={`${confirming.winner.name} takes all eligible pots?`}
          detail={`${confirming.winner.name} receives ${total} chips across ${pots.length} pot(s).`}
          confirmLabel="Confirm Take All"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            onCommand({
              _tag: 'take-all-eligible-pots',
              winnerId: confirming.winner.id,
            })
          }}
        />
      ) : null}
      {confirming?.kind === 'award' ? (
        <ConfirmSheet
          title={`Award ${confirming.pot.label}?`}
          detail={`${confirming.winner.name} receives ${confirming.pot.amount} chips.`}
          confirmLabel="Confirm Award"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            onCommand({
              _tag: 'award-pot',
              potId: confirming.pot.id,
              winnerId: confirming.winner.id,
            })
          }}
        />
      ) : null}
      {confirming?.kind === 'split' ? (
        <ConfirmSheet
          title={`Split ${confirming.pot.label}?`}
          detail={confirming.allocations
            .map((a) => `${nameFor(a.playerId)}: ${a.chips}`)
            .join(', ')}
          confirmLabel="Yes, Split"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            setSplitOpen(false)
            onCommand({
              _tag: 'split-pot',
              potId: confirming.pot.id,
              allocations: confirming.allocations,
            })
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Exactly-2-selected chop adjustment (ADR 0003 Decision 1): one zero-sum
 * slider between the two shares — moving it increases one side and
 * decreases the other by the same amount, so the pot stays 100% allocated
 * without a separate "adjust" call.
 */
function SplitSlider({
  players,
  allocations,
  potAmount,
  step,
  onChange,
}: {
  players: GamePlayer[]
  allocations: Record<string, number>
  potAmount: number
  step: number
  onChange(playerId: string, value: number): void
}) {
  const [first, second] = players
  if (!first || !second) return null
  const firstShare = allocations[first.id] ?? 0

  return (
    <div className="settlement__chop-slider">
      <span className="settlement__chop-slider-name">{first.name}</span>
      <input
        type="range"
        aria-label={`${first.name}'s share`}
        min={0}
        max={potAmount}
        step={step}
        value={firstShare}
        onChange={(e) => {
          const value = Math.max(0, Math.min(potAmount, Number(e.target.value)))
          onChange(first.id, value)
          onChange(second.id, potAmount - value)
        }}
      />
      <span className="settlement__chop-slider-name">{second.name}</span>
    </div>
  )
}
