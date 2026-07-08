// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { makeSetupSnapshot, makeTestPlayer } from '../../domain/state/fixtures'
import { SeatOverview } from './SeatOverview'

afterEach(cleanup)

describe('SeatOverview', () => {
  it('renders seats 1 through 10 with [Empty] rows filling live', () => {
    const base = makeSetupSnapshot({ playerCount: 0 })
    const snapshot = { ...base, players: [makeTestPlayer(0)] }
    render(<SeatOverview snapshot={snapshot} />)

    expect(screen.getAllByText('[Empty]')).toHaveLength(9)
    expect(screen.getByText('Player 1')).toBeTruthy()
  })

  it('flags a claimed seat with no chips as waiting to buy in', () => {
    const base = makeSetupSnapshot({ playerCount: 0 })
    const snapshot = {
      ...base,
      players: [
        makeTestPlayer(0, {
          stack: 0,
          totalChipsPurchased: 0,
          totalBuyInCents: 0,
          handStatus: 'needs-rebuy',
        }),
      ],
    }
    render(<SeatOverview snapshot={snapshot} />)
    expect(screen.getByText(/waiting to buy in/i)).toBeTruthy()
  })

  it('has no claim buttons — the console watches, it does not claim seats', () => {
    const base = makeSetupSnapshot({ playerCount: 2 })
    render(<SeatOverview snapshot={base} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
