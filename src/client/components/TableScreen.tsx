import { useState } from 'react'

import { canDealIn } from '../../domain/turn-order'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { formatMoneyUnits } from '../view-helpers'
import { getServerInfo, getUndoPreview } from '../api'
import { ActionPanel } from './ActionPanel'
import { ConfirmSheet } from './ConfirmSheet'
import { LiveTable } from './LiveTable'
import { ManageDrawer } from './ManageDrawer'
import { SettlementScreen } from './SettlementScreen'

export interface TableScreenProps {
  snapshot: GameSnapshot
  mySeat: number | null
  error: string | null
  onCommand(command: unknown): void
}

/**
 * The live gameplay shell (DESIGN.md App Shell): compact top bar, table
 * canvas, bottom action panel. A fixed full-viewport grid so core in-hand
 * controls never require scrolling in phone portrait; landscape shows a
 * rotate prompt instead of a second layout.
 */
export function TableScreen({ snapshot, mySeat, error, onCommand }: TableScreenProps) {
  const status = snapshot.game.status
  const hand = snapshot.hand
  const [manageOpen, setManageOpen] = useState(false)
  const [manageInitialView, setManageInitialView] = useState<'menu' | 'rebuy'>('menu')
  const [confirmingRebuy, setConfirmingRebuy] = useState(false)

  const settings = snapshot.game.settings
  const me = snapshot.players.find((p) => p.seatIndex === mySeat) ?? null
  const heroNeedsRebuy =
    status === 'between-hands' && me !== null && me.handStatus === 'needs-rebuy'
  // Mirrors the domain's start-hand rule exactly (hand-reducer.ts): fewer
  // than 2 dealt-in players means Next Hand WOULD be rejected. Surfacing
  // that here, disabled with a reason, replaces the old dead end where an
  // enabled button produced a rejection banner addressed to nobody.
  const dealtInCount = snapshot.players.filter(canDealIn).length
  const nextHandBlocked = status === 'between-hands' && dealtInCount < 2

  const openManage = (initialView: 'menu' | 'rebuy') => {
    setManageInitialView(initialView)
    setManageOpen(true)
  }

  return (
    <div className="live-screen">
      <header className="live-screen__topbar">
        <span className="live-screen__code">#{snapshot.game.code}</span>
        {error ? <span className="live-screen__error">{error}</span> : null}
        <button
          type="button"
          className="button live-screen__manage"
          onClick={() => openManage('menu')}
        >
          Manage
        </button>
      </header>

      {manageOpen ? (
        <ManageDrawer
          snapshot={snapshot}
          mySeat={mySeat}
          onCommand={onCommand}
          onClose={() => setManageOpen(false)}
          initialView={manageInitialView}
          // Preselect the viewer ONLY on the custom-rebuy deep link; the
          // plain Manage path keeps the drawer's own default (the busted
          // player may be rebuying someone else there).
          initialRebuyPlayerId={manageInitialView === 'rebuy' ? me?.id : undefined}
          loadUndoPreview={() => getUndoPreview(snapshot.game.code)}
          loadServerInfo={getServerInfo}
        />
      ) : null}

      {status === 'showdown' ? (
        <div className="live-screen__settlement">
          <SettlementScreen snapshot={snapshot} onCommand={onCommand} />
        </div>
      ) : (
        <LiveTable snapshot={snapshot} mySeat={mySeat} />
      )}

      <footer className="live-screen__footer">
        {status === 'in-hand' && hand?.nextStreetReady ? (
          <button
            type="button"
            className="button button--primary live-screen__next-street"
            onClick={() => onCommand({ _tag: 'confirm-next-street' })}
          >
            Next street
          </button>
        ) : null}
        {status === 'in-hand' && mySeat !== null ? (
          <ActionPanel snapshot={snapshot} mySeat={mySeat} onCommand={onCommand} />
        ) : null}
        {heroNeedsRebuy ? (
          <section className="card rebuy-prompt" aria-label="You're out of chips">
            <h3 className="card__title">You&apos;re out of chips.</h3>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setConfirmingRebuy(true)}
            >
              {`Rebuy ${formatMoneyUnits(settings.defaultBuyInCents)} ${settings.currency} → ${settings.defaultStack} chips`}
            </button>
            <button
              type="button"
              className="button rebuy-prompt__secondary"
              onClick={() => openManage('rebuy')}
            >
              Custom rebuy
            </button>
            <button
              type="button"
              className="button rebuy-prompt__tertiary"
              onClick={() => onCommand({ _tag: 'sit-out' })}
            >
              Sit out
            </button>
          </section>
        ) : null}
        {status === 'between-hands' ? (
          <>
            <button
              type="button"
              className="button button--primary live-screen__next-hand"
              disabled={nextHandBlocked}
              onClick={() => onCommand({ _tag: 'start-hand' })}
            >
              Next Hand
            </button>
            {nextHandBlocked ? (
              <p className="manage-drawer__reason">
                Waiting for players to rebuy — need 2 with chips
              </p>
            ) : null}
          </>
        ) : null}
      </footer>

      <div className="rotate-prompt" role="note">
        <p>Rotate your phone back to portrait to keep playing.</p>
      </div>

      {confirmingRebuy && me ? (
        <ConfirmSheet
          title={`Rebuy for ${me.name}?`}
          detail={`${me.name} receives ${settings.defaultStack} chips for ${formatMoneyUnits(settings.defaultBuyInCents)} ${settings.currency}.`}
          confirmLabel="Confirm Rebuy"
          onCancel={() => setConfirmingRebuy(false)}
          onConfirm={() => {
            setConfirmingRebuy(false)
            onCommand({
              _tag: 'record-rebuy',
              playerId: me.id,
              money: { currency: settings.currency, cents: settings.defaultBuyInCents },
              chips: settings.defaultStack,
            })
          }}
        />
      ) : null}
    </div>
  )
}
