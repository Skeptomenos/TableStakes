// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { startedHand } from '../../domain/testing'
import { TableScreen } from './TableScreen'

afterEach(cleanup)

describe('manage pill', () => {
  it('opens and closes the manage drawer (Slice 10)', () => {
    render(
      <TableScreen
        snapshot={startedHand({ playerCount: 3 })}
        mySeat={0}
        error={null}
        onCommand={vi.fn()}
      />,
    )
    const pill = screen.getByRole('button', { name: 'Manage' }) as HTMLButtonElement
    expect(pill.disabled).toBe(false)

    fireEvent.click(pill)
    expect(screen.getByRole('dialog', { name: /manage/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog', { name: /manage/i })).toBeNull()
  })
})
