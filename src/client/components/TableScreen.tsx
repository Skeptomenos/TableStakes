import { useState } from 'react'

import type { GameSnapshot } from '../../shared/schema/snapshot'
import { getUndoPreview } from '../api'
import { ActionPanel } from './ActionPanel'
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

  return (
    <div className="live-screen">
      <header className="live-screen__topbar">
        <span className="live-screen__code">#{snapshot.game.code}</span>
        {error ? <span className="live-screen__error">{error}</span> : null}
        <button
          type="button"
          className="button live-screen__manage"
          onClick={() => setManageOpen(true)}
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
          loadUndoPreview={() => getUndoPreview(snapshot.game.code)}
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
        {status === 'between-hands' ? (
          <button
            type="button"
            className="button button--primary live-screen__next-hand"
            onClick={() => onCommand({ _tag: 'start-hand' })}
          >
            Next Hand
          </button>
        ) : null}
      </footer>

      <div className="rotate-prompt" role="note">
        <p>Rotate your phone back to portrait to keep playing.</p>
      </div>
    </div>
  )
}
