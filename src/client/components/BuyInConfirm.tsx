import type { GameSettings } from '../../shared/schema/snapshot'
import { formatMoneyUnits } from '../view-helpers'

export interface BuyInConfirmProps {
  settings: GameSettings
  onConfirm(): void
}

/**
 * Explicit buy-in confirmation (ADR 0002): the fixed table default stated
 * plainly, one primary confirm action, no amount entry — everyone starts
 * equal, one tap. Sends record-buy-in with EXACTLY the snapshot defaults;
 * the domain rejects anything else (Slice 2).
 */
export function BuyInConfirm({ settings, onConfirm }: BuyInConfirmProps) {
  const money = formatMoneyUnits(settings.defaultBuyInCents)

  return (
    <section className="card" aria-label="Confirm buy-in">
      <h2 className="card__title">Confirm your buy-in</h2>
      <p className="setup-ratio">
        {money} {settings.currency} = {settings.defaultStack} chips
      </p>
      <button
        type="button"
        className="button button--primary"
        onClick={onConfirm}
      >
        Buy in for {money} {settings.currency} → {settings.defaultStack} chips
      </button>
    </section>
  )
}
