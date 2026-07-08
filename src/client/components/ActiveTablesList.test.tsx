// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActiveTablesList } from './ActiveTablesList'

afterEach(cleanup)

describe('ActiveTablesList', () => {
  it('shows a message when there are no open tables', () => {
    render(<ActiveTablesList games={[]} onJoin={() => {}} />)
    expect(screen.getByText(/no open tables/i)).toBeTruthy()
  })

  it('renders one row per table with code and seated count, tap to join', () => {
    const onJoin = vi.fn()
    render(
      <ActiveTablesList
        games={[
          { code: '48317', status: 'setup', seatedCount: 3, createdAt: 1 },
          { code: '11111', status: 'setup', seatedCount: 0, createdAt: 2 },
        ]}
        onJoin={onJoin}
      />,
    )
    expect(screen.getByText('#48317')).toBeTruthy()
    expect(screen.getByText('3 seated')).toBeTruthy()
    expect(screen.getByText('#11111')).toBeTruthy()
    expect(screen.getByText('0 seated')).toBeTruthy()

    fireEvent.click(screen.getByText('#48317'))
    expect(onJoin).toHaveBeenCalledWith('48317')
  })
})
