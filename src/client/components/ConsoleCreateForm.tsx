import { useState } from 'react'

import type { GameSettings } from '../../shared/schema/snapshot'

export interface ConsoleSettingsPayload {
  currency: string
  defaultBuyInCents: number
  defaultStack: number
  smallBlind: number
  bigBlind: number
  strictMode: boolean
  raiseRule: GameSettings['raiseRule']
  amountStep: { kind: 'follow-small-blind' }
}

export interface ConsoleCreateFormProps {
  onCreate(settings: ConsoleSettingsPayload): void
}

/**
 * The console's table-settings form (ADR 0002, DESIGN.md Console
 * table-settings fields): settings only — no dealer pick and no buy-ins
 * here, both moved to their own phases (console dealer pick once 2+
 * players buy in; phone-side buy-in confirmation). Reuses the SetupForm
 * field set and money-to-chip ratio line.
 */
export function ConsoleCreateForm({ onCreate }: ConsoleCreateFormProps) {
  const [currency, setCurrency] = useState('EUR')
  const [buyIn, setBuyIn] = useState(10)
  const [stack, setStack] = useState(1000)
  const [smallBlind, setSmallBlind] = useState(50)
  const [bigBlind, setBigBlind] = useState(100)
  const [strictMode, setStrictMode] = useState(false)

  const number = (value: string, fallback: number) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  }

  return (
    <section className="card" aria-label="Table settings">
      <h2 className="card__title">Table settings</h2>

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

      <button
        type="button"
        className="button button--primary"
        onClick={() =>
          onCreate({
            currency,
            defaultBuyInCents: Math.round(buyIn * 100),
            defaultStack: stack,
            smallBlind,
            bigBlind,
            strictMode,
            raiseRule: 'any',
            amountStep: { kind: 'follow-small-blind' },
          })
        }
      >
        Create Table
      </button>
    </section>
  )
}
