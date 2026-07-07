// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { interruptSeat } from '../../domain/seats'
import { mustOk, played, startedHand } from '../../domain/testing'
import { makeBetweenHandsSnapshot } from '../../domain/state/fixtures'
import type { GameSnapshot } from '../../shared/schema/snapshot'
import { ManageDrawer, type UndoPreview } from './ManageDrawer'

afterEach(cleanup)

const nothingToUndo = () => Promise.resolve(null)

function renderDrawer(
  snapshot: GameSnapshot,
  options: {
    mySeat?: number | null
    preview?: UndoPreview | null
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
      loadUndoPreview={
        options.preview === undefined
          ? nothingToUndo
          : () => Promise.resolve(options.preview ?? null)
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

describe('rebuy', () => {
  it('collects player and amounts, then confirms a record-rebuy', () => {
    const s = makeBetweenHandsSnapshot({ playerCount: 3 })
    const { onCommand } = renderDrawer(s, { mySeat: 0 })

    fireEvent.click(screen.getByRole('button', { name: /rebuy/i }))
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
