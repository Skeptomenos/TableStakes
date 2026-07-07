// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { JoinByCode } from './JoinByCode'

afterEach(cleanup)

// DESIGN.md Join Game: manual game-code input — players without the QR/URL
// can type the five-digit code (Slice 12 design QA).

describe('JoinByCode', () => {
  it('joins with a valid five-digit code', () => {
    const onJoin = vi.fn()
    render(<JoinByCode onJoin={onJoin} />)

    const input = screen.getByLabelText(/game code/i)
    fireEvent.change(input, { target: { value: '48317' } })
    fireEvent.click(screen.getByRole('button', { name: /join/i }))
    expect(onJoin).toHaveBeenCalledWith('48317')
  })

  it('disables join until the code is exactly five digits', () => {
    const onJoin = vi.fn()
    render(<JoinByCode onJoin={onJoin} />)

    const input = screen.getByLabelText(/game code/i)
    const button = screen.getByRole('button', { name: /join/i })

    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '483' } })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '48317' } })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('strips non-digits and caps at five characters', () => {
    render(<JoinByCode onJoin={() => {}} />)
    const input = screen.getByLabelText(/game code/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '4a8b3c1d7e9' } })
    expect(input.value).toBe('48317')
  })

  it('submits from the keyboard via the form', () => {
    const onJoin = vi.fn()
    render(<JoinByCode onJoin={onJoin} />)
    const input = screen.getByLabelText(/game code/i)
    fireEvent.change(input, { target: { value: '55555' } })
    fireEvent.submit(input.closest('form')!)
    expect(onJoin).toHaveBeenCalledWith('55555')
  })
})
