// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeSetupSnapshot, makeTestPlayer } from '../../domain/state/fixtures'
import { SeatList } from './SeatList'

afterEach(cleanup)

function snapshotWithSeats() {
  const base = makeSetupSnapshot({ playerCount: 0 })
  return {
    ...base,
    players: [
      makeTestPlayer(0, { connection: 'connected' }),
      makeTestPlayer(1, { connection: 'interrupted' }),
      makeTestPlayer(2, { connection: 'released' }),
    ],
  }
}

describe('SeatList', () => {
  it('renders locked, reclaimable, released, and free seat states', () => {
    const { container } = render(
      <SeatList snapshot={snapshotWithSeats()} onClaim={() => {}} />,
    )

    // Active connected seats are locked and show a lock icon (DESIGN.md:
    // "Locked seats show a lock icon and `Locked`").
    expect(screen.getByText('Locked')).toBeTruthy()
    expect(container.querySelector('.badge--locked svg')).toBeTruthy()
    // Interrupted seats offer recovery.
    expect(screen.getByText('Reclaim')).toBeTruthy()
    // Released seats plus the 7 empty seats are claimable.
    expect(screen.getAllByText('Claim Seat')).toHaveLength(8)
  })

  it('claims a free seat with the seat index', () => {
    const onClaim = vi.fn()
    render(<SeatList snapshot={snapshotWithSeats()} onClaim={onClaim} />)
    fireEvent.click(screen.getAllByText('Claim Seat')[0]!)
    expect(onClaim).toHaveBeenCalledWith(2) // released seat comes first
  })

  it('never renders PIN or password surfaces', () => {
    const { container } = render(
      <SeatList snapshot={snapshotWithSeats()} onClaim={() => {}} />,
    )
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByText(/pin|password/i)).toBeNull()
  })
})
