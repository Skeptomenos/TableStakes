// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { interruptSeat } from '../../domain/seats'
import { mustOk, played, startedHand } from '../../domain/testing'
import { makeBetweenHandsSnapshot, makeTestSettings } from '../../domain/state/fixtures'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { ManageDrawer, type UndoPreview } from './ManageDrawer'

afterEach(cleanup)

const nothingToUndo = () => Promise.resolve(null)
const noAddresses = () => Promise.resolve({ addresses: [], localhostOnly: true })

function renderDrawer(
  snapshot: GameSnapshot,
  options: {
    mySeat?: number | null
    preview?: UndoPreview | null
    serverInfo?: { addresses: string[]; localhostOnly: boolean }
    initialView?: 'menu' | 'rebuy' | 'correction' | 'settings' | 'share'
    initialRebuyPlayerId?: string
  } = {},
) {
  const onCommand = vi.fn()
  const onClose = vi.fn()
  render(
    <ManageDrawer
      snapshot={snapshot}
      mySeat={options.mySeat ?? 0}
      onCommand={onCommand}
      onClose={onClose}
      initialView={options.initialView}
      initialRebuyPlayerId={options.initialRebuyPlayerId}
      loadUndoPreview={
        options.preview === undefined
          ? nothingToUndo
          : () => Promise.resolve(options.preview ?? null)
      }
      loadServerInfo={
        options.serverInfo ? () => Promise.resolve(options.serverInfo!) : noAddresses
      }
    />,
  )
  return { onCommand, onClose }
}

describe('menu', () => {
  it('lists the shared table actions', () => {
    renderDrawer(startedHand({ playerCount: 3 }))
    for (const label of [
      /undo last action/i,
      /cancel hand/i,
      /rebuy/i,
      /move chips/i,
      /settings/i,
      /reset game/i,
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('closes from the header', () => {
    const { onClose } = renderDrawer(startedHand({ playerCount: 3 }))
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('undo', () => {
  it('previews the latest transaction and sends its id on confirm', async () => {
    const { onCommand } = renderDrawer(startedHand({ playerCount: 3 }), {
      preview: {
        transactionId: 'vtx_9',
        label: 'Award pot',
        events: ['pot-awarded'],
        undoable: true,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /undo last action/i }))
    await waitFor(() => expect(screen.getByText(/award pot/i)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /confirm undo/i }))
    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'undo',
      expectedTransactionId: 'vtx_9',
    })
  })

  it('says so when there is nothing to undo', async () => {
    const { onCommand } = renderDrawer(startedHand({ playerCount: 3 }), {
      preview: null,
    })
    fireEvent.click(screen.getByRole('button', { name: /undo last action/i }))
    await waitFor(() => expect(screen.getByText(/nothing to undo/i)).toBeTruthy())
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('explains a non-undoable transaction instead of offering confirm (PR #182 re-review)', async () => {
    const { onCommand } = renderDrawer(startedHand({ playerCount: 3 }), {
      preview: {
        transactionId: 'vtx_9',
        label: 'seat-released',
        events: ['seat-released'],
        undoable: false,
        reason:
          'a seat release cannot be undone; the player can reclaim the seat instead',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /undo last action/i }))
    await waitFor(() => expect(screen.getByText(/reclaim/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /confirm undo/i })).toBeNull()
    expect(onCommand).not.toHaveBeenCalled()
  })
})

describe('recovery actions', () => {
  it('cancel hand confirms with refund copy', () => {
    const { onCommand } = renderDrawer(startedHand({ playerCount: 3 }))
    fireEvent.click(screen.getByRole('button', { name: /cancel hand/i }))
    expect(screen.getByText(/blinds/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /confirm cancel/i }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'cancel-hand' })
  })

  it('offers to mark the blocking interrupted player folded', () => {
    let s = startedHand({ playerCount: 3 })
    s = mustOk(interruptSeat(s, 0), 'interrupt').snapshot
    const { onCommand } = renderDrawer(s, { mySeat: 1 })

    fireEvent.click(screen.getByRole('button', { name: /mark player 1 folded/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm fold/i }))
    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'mark-interrupted-folded',
      seatIndex: 0,
    })
  })

  it('does not offer marking when the blocking player is connected', () => {
    renderDrawer(startedHand({ playerCount: 3 }), { mySeat: 1 })
    expect(screen.queryByRole('button', { name: /folded/i })).toBeNull()
  })

  it('restores a folded player after confirmation', () => {
    let s = startedHand({ playerCount: 3 })
    s = played(s, 0, { kind: 'fold' })
    const { onCommand } = renderDrawer(s, { mySeat: 1 })

    fireEvent.click(screen.getByRole('button', { name: /restore player 1/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm restore/i }))
    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'restore-folded-player',
      seatIndex: 0,
    })
  })

  it('hands the turn to another player after confirmation', () => {
    const s = startedHand({ playerCount: 3 })
    const { onCommand } = renderDrawer(s, { mySeat: 1 })

    fireEvent.click(screen.getByRole('button', { name: /turn to player 3/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm turn/i }))
    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'set-active-player',
      seatIndex: 2,
    })
  })

  it('releases a disconnected seat after confirmation', () => {
    let s = startedHand({ playerCount: 3 })
    s = mustOk(interruptSeat(s, 2), 'interrupt').snapshot
    const { onCommand } = renderDrawer(s, { mySeat: 0 })

    fireEvent.click(screen.getByRole('button', { name: /release player 3/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm release/i }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'release-seat', seatIndex: 2 })
  })
})

describe('sit-out and return', () => {
  it('sends sit-out for my seat without extra confirmation', () => {
    const { onCommand, onClose } = renderDrawer(
      makeBetweenHandsSnapshot({ playerCount: 3 }),
      { mySeat: 2 },
    )
    fireEvent.click(screen.getByRole('button', { name: /sit out next hand/i }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'sit-out' })
    expect(onClose).toHaveBeenCalled()
  })

  it('offers return instead when I am sitting out', () => {
    const base = makeBetweenHandsSnapshot({ playerCount: 3 })
    const s = {
      ...base,
      players: base.players.map((p) =>
        p.seatIndex === 2
          ? { ...p, sitOutNextHand: true, handStatus: 'sitting-out' as const }
          : p,
      ),
    }
    const { onCommand } = renderDrawer(s, { mySeat: 2 })
    fireEvent.click(screen.getByRole('button', { name: /return next hand/i }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'return-from-sit-out' })
  })
})

// ADR 0002, Slice 4: rebuys offer Full/Half/Custom quick-picks and cannot
// exceed the table default client-side either — the same cap the domain
// enforces (Slice 2), surfaced before the player ever submits.
describe('rebuy', () => {
  it('Full quick-pick selects exactly the table default', () => {
    const s = makeBetweenHandsSnapshot({ playerCount: 3 })
    const { onCommand } = renderDrawer(s, { mySeat: 0 })

    fireEvent.click(screen.getByRole('button', { name: /rebuy/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    fireEvent.click(screen.getByRole('button', { name: /review rebuy/i }))
    const sheet = screen.getByRole('dialog', { name: /rebuy for player 1/i })
    expect(sheet.textContent).toContain('1000 chips')
    fireEvent.click(screen.getByRole('button', { name: /confirm rebuy/i }))

    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'record-rebuy',
      playerId: s.players[0]!.id,
      money: { currency: 'EUR', cents: 1000 },
      chips: 1000,
    })
  })

  it('Half quick-pick selects half the default, rounded to the chip ratio', () => {
    const s = makeBetweenHandsSnapshot({ playerCount: 3 })
    renderDrawer(s, { mySeat: 0 })

    fireEvent.click(screen.getByRole('button', { name: /rebuy/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Half' }))
    expect(screen.getByText('500 chips')).toBeTruthy()
    // Money is derived from the chip ratio, never typed directly.
    expect(screen.getByText(/5\.00 EUR/)).toBeTruthy()
  })

  it('Custom amount is capped at the table default — cannot type above it', () => {
    const s = makeBetweenHandsSnapshot({ playerCount: 3 })
    renderDrawer(s, { mySeat: 0 })

    fireEvent.click(screen.getByRole('button', { name: /rebuy/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText(/chips/i), { target: { value: '5000' } })

    // Clamped, not merely disabled: the field itself never holds an
    // above-cap value the player could still submit.
    const chipsInput = screen.getByLabelText(/chips/i) as HTMLInputElement
    expect(Number(chipsInput.value)).toBeLessThanOrEqual(1000)
    const reviewButton = screen.getByRole('button', {
      name: /review rebuy/i,
    }) as HTMLButtonElement
    expect(reviewButton.disabled).toBe(false)
  })

  it('sends the TABLE currency in the rebuy command, not a hardcoded EUR', () => {
    // FINAL-verification finding: the confirm sheet hardcoded
    // `currency: 'EUR'` while the console makes non-EUR tables reachable —
    // the domain's currency check would reject every rebuy on such tables.
    const s = makeBetweenHandsSnapshot({
      playerCount: 3,
      settings: makeTestSettings({ currency: 'GBP' }),
    })
    const { onCommand } = renderDrawer(s, { mySeat: 0 })

    fireEvent.click(screen.getByRole('button', { name: /rebuy/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    fireEvent.click(screen.getByRole('button', { name: /review rebuy/i }))
    const sheet = screen.getByRole('dialog', { name: /rebuy for player 1/i })
    expect(sheet.textContent).toContain('GBP')
    expect(sheet.textContent).not.toContain('EUR')
    fireEvent.click(screen.getByRole('button', { name: /confirm rebuy/i }))

    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'record-rebuy',
      playerId: s.players[0]!.id,
      money: { currency: 'GBP', cents: 1000 },
      chips: 1000,
    })
  })

  it('disables Review Rebuy with a reason when the amount is invalid', () => {
    const s = makeBetweenHandsSnapshot({ playerCount: 3 })
    renderDrawer(s, { mySeat: 0 })

    fireEvent.click(screen.getByRole('button', { name: /rebuy/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText(/chips/i), { target: { value: '0' } })

    const reviewButton = screen.getByRole('button', {
      name: /review rebuy/i,
    }) as HTMLButtonElement
    expect(reviewButton.disabled).toBe(true)
    expect(screen.getByText(/amount must be/i)).toBeTruthy()
  })

  it('collects player and confirms a record-rebuy at the selected amount', () => {
    const s = makeBetweenHandsSnapshot({ playerCount: 3 })
    const { onCommand } = renderDrawer(s, { mySeat: 0 })

    fireEvent.click(screen.getByRole('button', { name: /rebuy/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText(/chips/i), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: /review rebuy/i }))
    // Confirmation copy must state the player and amount (SPEC.md).
    const sheet = screen.getByRole('dialog', { name: /rebuy for player 1/i })
    expect(sheet.textContent).toContain('500 chips')
    fireEvent.click(screen.getByRole('button', { name: /confirm rebuy/i }))

    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'record-rebuy',
      playerId: s.players[0]!.id,
      money: { currency: 'EUR', cents: 500 },
      chips: 500,
    })
  })
})

// ADR 0003: the needs-rebuy prompt card's "Custom rebuy" secondary deep-
// links directly into the drawer's existing rebuy view, preselected to the
// busted viewer, instead of duplicating a second custom-rebuy form.
describe('initial view deep-link (ADR 0003)', () => {
  it('opens directly on the rebuy view, preselected to the given player', () => {
    const s = makeBetweenHandsSnapshot({ playerCount: 3 })
    const targetId = s.players[1]!.id
    renderDrawer(s, { initialView: 'rebuy', initialRebuyPlayerId: targetId })

    expect(screen.getByText('Rebuy / Add Chips')).toBeTruthy()
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe(targetId)
  })

  it('defaults to the menu view when no initial view is given (no behavior change)', () => {
    renderDrawer(makeBetweenHandsSnapshot({ playerCount: 3 }))
    expect(screen.getByText('Manage Table')).toBeTruthy()
  })
})

// ADR 0002, Slice 4: a late arrival can be onboarded from any phone
// mid-game — the share card must be reachable from the drawer, not just
// during setup.
describe('share', () => {
  it('the menu offers Share this table', () => {
    renderDrawer(startedHand({ playerCount: 3 }))
    expect(
      screen.getByRole('button', { name: /share this table/i }),
    ).toBeTruthy()
  })

  it('opens a view rendering the ShareCard for the current code, even mid-hand', async () => {
    const s = startedHand({ playerCount: 3 })
    renderDrawer(s)

    fireEvent.click(screen.getByRole('button', { name: /share this table/i }))
    await waitFor(() => screen.getByLabelText(/qr code/i))
    expect(screen.getByText(s.game.code)).toBeTruthy()
    // Both the drawer header and the ShareCard itself say "Share this
    // table" once this view is open — two matches is the expected shape.
    expect(screen.getAllByText('Share this table')).toHaveLength(2)
  })
})

describe('corrections', () => {
  it('builds a zero-sum stack move with a reason', () => {
    const s = startedHand({ playerCount: 3 })
    const { onCommand } = renderDrawer(s, { mySeat: 0 })

    fireEvent.click(screen.getByRole('button', { name: /move chips/i }))
    fireEvent.change(screen.getByLabelText(/from/i), {
      target: { value: `player:${s.players[0]!.id}` },
    })
    fireEvent.change(screen.getByLabelText(/^to/i), {
      target: { value: `player:${s.players[1]!.id}` },
    })
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: 'stack miscount' },
    })
    fireEvent.click(screen.getByRole('button', { name: /review correction/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm correction/i }))

    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'apply-correction',
      reason: 'stack miscount',
      moves: [
        { target: { kind: 'player-stack', playerId: s.players[0]!.id }, delta: -100 },
        { target: { kind: 'player-stack', playerId: s.players[1]!.id }, delta: 100 },
      ],
    })
  })
})

describe('table settings and reset', () => {
  it('applies blind changes through update-blinds', () => {
    const { onCommand } = renderDrawer(startedHand({ playerCount: 3 }), {
      mySeat: 0,
    })
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    fireEvent.change(screen.getByLabelText(/small blind/i), {
      target: { value: '100' },
    })
    fireEvent.change(screen.getByLabelText(/big blind/i), {
      target: { value: '200' },
    })
    fireEvent.click(screen.getByRole('button', { name: /apply blinds/i }))
    expect(onCommand).toHaveBeenCalledWith({
      _tag: 'update-blinds',
      smallBlind: 100,
      bigBlind: 200,
    })
  })

  it('offers Finish Game between hands with cash-out confirmation copy', () => {
    const { onCommand } = renderDrawer(makeBetweenHandsSnapshot({ playerCount: 3 }), {
      mySeat: 0,
    })
    fireEvent.click(screen.getByRole('button', { name: /finish game/i }))
    expect(onCommand).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /finish/i }).textContent).toMatch(
      /cash-out/i,
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm finish/i }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'finish-game' })
  })

  it('does not offer Finish Game during a live hand', () => {
    renderDrawer(startedHand({ playerCount: 3 }), { mySeat: 0 })
    expect(screen.queryByRole('button', { name: /finish game/i })).toBeNull()
  })

  it('resets the game only after confirmation', () => {
    const { onCommand } = renderDrawer(startedHand({ playerCount: 3 }), {
      mySeat: 0,
    })
    fireEvent.click(screen.getByRole('button', { name: /reset game/i }))
    expect(onCommand).not.toHaveBeenCalled()
    expect(screen.getByText(/purchased/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /confirm reset/i }))
    expect(onCommand).toHaveBeenCalledWith({ _tag: 'reset-game' })
  })
})
