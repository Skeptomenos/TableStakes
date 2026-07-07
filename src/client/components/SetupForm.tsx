import { useState } from 'react'

import type { GameSettings, GameSnapshot } from '../../shared/schema/snapshot'
import { bySeatOrder } from '../view-helpers'

export interface SetupPayload {
  settings: {
    currency: string
    defaultBuyInCents: number
    defaultStack: number
    smallBlind: number
    bigBlind: number
    strictMode: boolean
    raiseRule: GameSettings['raiseRule']
    amountStep: { kind: 'follow-small-blind' }
  }
  dealerSeat: number
}

export interface SetupFormProps {
  snapshot: GameSnapshot
  onStart(payload: SetupPayload): void
}

/**
 * First-hand setup: one compact screen, not a wizard (SPEC.md). Shows the
 * money-to-chip relationship directly; chips are never labeled as the
 * currency. Dealer is a single selection; strict mode defaults off. The
 * raise rule stays out of setup (game settings own it later).
 */
export function SetupForm({ snapshot, onStart }: SetupFormProps) {
  const [currency, setCurrency] = useState('EUR')
  const [buyIn, setBuyIn] = useState(10)
  const [stack, setStack] = useState(1000)
  const [smallBlind, setSmallBlind] = useState(50)
  const [bigBlind, setBigBlind] = useState(100)
  const [strictMode, setStrictMode] = useState(false)
  const [dealerSeat, setDealerSeat] = useState<number | null>(
    snapshot.game.dealerSeat,
  )

  const players = bySeatOrder(snapshot.players)

  const number = (value: string, fallback: number) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  }

  return (
    <section className="card" aria-label="First-hand setup">
      <h2 className="card__title">First-hand setup</h2>

      <div className="field-grid">
        <label className="field">
          <span>Currency</span>
          <input
            className="input"
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <label className="field">
          <span>Default buy-in ({currency})</span>
          <input
            className="input"
            type="number"
            value={buyIn}
            onChange={(e) => setBuyIn(number(e.target.value, buyIn))}
          />
        </label>
        <label className="field">
          <span>Default chip stack</span>
          <input
            className="input"
            type="number"
            value={stack}
            onChange={(e) => setStack(number(e.target.value, stack))}
          />
        </label>
        <label className="field">
          <span>Small blind</span>
          <input
            className="input"
            type="number"
            value={smallBlind}
            onChange={(e) => setSmallBlind(number(e.target.value, smallBlind))}
          />
        </label>
        <label className="field">
          <span>Big blind</span>
          <input
            className="input"
            type="number"
            value={bigBlind}
            onChange={(e) => setBigBlind(number(e.target.value, bigBlind))}
          />
        </label>
        <label className="field field--toggle">
          <span>Strict mode</span>
          <input
            type="checkbox"
            checked={strictMode}
            onChange={(e) => setStrictMode(e.target.checked)}
          />
        </label>
      </div>

      <p className="setup-ratio">
        {buyIn} {currency} = {stack} chips
      </p>

      <fieldset className="dealer-select">
        <legend>Dealer</legend>
        {players.map((player) => (
          <label key={player.id} className="dealer-select__row">
            <input
              type="radio"
              name="dealer"
              checked={dealerSeat === Number(player.seatIndex)}
              onChange={() => setDealerSeat(Number(player.seatIndex))}
            />
            <span>{player.name}</span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className="button button--primary"
        disabled={dealerSeat === null || players.length < 2}
        onClick={() => {
          if (dealerSeat === null) return
          onStart({
            settings: {
              currency,
              defaultBuyInCents: Math.round(buyIn * 100),
              defaultStack: stack,
              smallBlind,
              bigBlind,
              strictMode,
              raiseRule: 'any',
              amountStep: { kind: 'follow-small-blind' },
            },
            dealerSeat,
          })
        }}
      >
        Start Game
      </button>
    </section>
  )
}
