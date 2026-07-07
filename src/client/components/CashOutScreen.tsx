import { useEffect, useMemo, useState } from 'react'

import { computeCashOut } from '../../domain/cash-out'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { formatCents, formatNetCents } from '../view-helpers'
import { ConfirmSheet } from './ConfirmSheet'

export interface TransferDraft {
  fromProfileId: string
  toProfileId: string
  cents: number
}

export interface FinalizedSettlement {
  finalizedAt: number
  transfers: TransferDraft[]
}

export interface CashOutScreenProps {
  snapshot: GameSnapshot
  /** Resolves true once the server ACCEPTED the command. */
  onCommand(command: unknown): Promise<boolean>
  /** The recorded settlement; null while cash-out is still open. */
  loadSettlement(): Promise<FinalizedSettlement | null>
}

/**
 * End-of-night cash-out (SPEC.md): per-player buy-ins, final chips,
 * pool-proportional cash-out value and net, the explicit rounding
 * remainder, and editable minimized transfers. Finalizing records the
 * (possibly edited) payments; the screen then shows the settled summary.
 */
export function CashOutScreen({
  snapshot,
  onCommand,
  loadSettlement,
}: CashOutScreenProps) {
  const summary = useMemo(() => computeCashOut(snapshot), [snapshot])
  const currency = snapshot.game.settings.currency
  const nameFor = (profileId: string) =>
    snapshot.players.find((p) => p.profileId === profileId)?.name ?? profileId

  const suggested = useMemo<TransferDraft[]>(
    () =>
      summary.suggestedTransfers.map((t) => ({
        fromProfileId: t.fromProfileId as string,
        toProfileId: t.toProfileId as string,
        cents: t.cents as number,
      })),
    [summary],
  )
  const [transfers, setTransfers] = useState<TransferDraft[]>(suggested)
  const [settled, setSettled] = useState<FinalizedSettlement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Re-read whenever the broadcast snapshot advances: another phone's
  // finalize must flip this screen to Settled too (Slice 12; the server
  // guard already rejects the stale finalize, this keeps the view honest).
  const eventCursor = snapshot.eventCursor
  useEffect(() => {
    let cancelled = false
    loadSettlement()
      .then((settlement) => {
        if (!cancelled) setSettled(settlement)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
    // Depends on the cursor only: parents recreate the loadSettlement
    // closure every render, and a fetched settlement has fresh object
    // identity, so depending on either would refetch in a loop.
  }, [eventCursor])

  const validTransfers = transfers.every(
    (t) => Number.isSafeInteger(t.cents) && t.cents > 0,
  )
  const totalCents = transfers.reduce((sum, t) => sum + t.cents, 0)
  const shownTransfers = settled ? settled.transfers : transfers

  return (
    <section className="cash-out stack" aria-label="Cash-out">
      <h2 className="route-title">
        Cash-Out {settled ? <span className="cash-out__settled">Settled</span> : null}
      </h2>

      <div className="card">
        <div className="cash-out__row cash-out__row--head">
          <span>Player</span>
          <span>Buy-in</span>
          <span>Chips</span>
          <span>Cash-out</span>
          <span>Net</span>
        </div>
        {summary.players.map((player) => (
          <div key={player.playerId} className="cash-out__row">
            <span>{nameFor(player.profileId)}</span>
            <span>{formatCents(player.buyInCents)}</span>
            <span>{player.finalChips}</span>
            <span>{formatCents(player.cashOutCents)}</span>
            <span
              className={
                player.netCents >= 0 ? 'cash-out__net-win' : 'cash-out__net-loss'
              }
            >
              {formatNetCents(player.netCents)}
            </span>
          </div>
        ))}
        <p className="cash-out__totals">
          Total buy-ins {formatCents(summary.totalBuyInCents)} {currency} — total
          cash-out {formatCents(summary.totalCashOutCents)} {currency}
        </p>
        {summary.roundingRemainderCents > 0 ? (
          <p className="cash-out__note">
            Rounding remainder of {summary.roundingRemainderCents} cent(s)
            assigned to the largest fractional shares.
          </p>
        ) : null}
      </div>

      <div className="card">
        <h3 className="card__title">Payments</h3>
        {shownTransfers.length === 0 ? (
          <p className="cash-out__note">Everyone is even — no payments needed.</p>
        ) : null}
        {shownTransfers.map((transfer, index) => (
          <div
            key={`${transfer.fromProfileId}-${transfer.toProfileId}-${index}`}
            className="cash-out__transfer"
          >
            <span>
              {nameFor(transfer.fromProfileId)} pays {nameFor(transfer.toProfileId)}
            </span>
            {settled ? (
              <span>
                {formatCents(transfer.cents)} {currency}
              </span>
            ) : (
              <>
                <input
                  className="input cash-out__cents"
                  type="number"
                  aria-label="Transfer amount (cents)"
                  min={1}
                  value={transfer.cents}
                  onChange={(e) => {
                    const cents = Number(e.target.value)
                    setTransfers((prev) =>
                      prev.map((t, i) => (i === index ? { ...t, cents } : t)),
                    )
                  }}
                />
                <button
                  type="button"
                  className="button"
                  aria-label="Remove transfer"
                  onClick={() =>
                    setTransfers((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
        {!settled && loaded ? (
          <div className="cash-out__actions">
            <button
              type="button"
              className="button"
              onClick={() => setTransfers(suggested)}
            >
              Reset to Suggested
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!validTransfers}
              onClick={() => setConfirming(true)}
            >
              Finalize Cash-Out
            </button>
          </div>
        ) : null}
      </div>

      {confirming ? (
        <ConfirmSheet
          title="Finalize cash-out?"
          detail={`Records ${transfers.length} transfer(s) totaling ${formatCents(totalCents)} ${currency}. This is the final settlement for the night.`}
          confirmLabel="Confirm Cash-Out"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            // Settled state comes from the SERVER, never optimistically: a
            // rejected finalize must leave the screen editable (PR #183
            // review). After an ack, re-read the recorded settlement.
            void onCommand({ _tag: 'finalize-cash-out', transfers })
              .then((accepted) =>
                accepted ? loadSettlement().then(setSettled) : undefined,
              )
              .catch(() => {})
          }}
        />
      ) : null}
    </section>
  )
}
