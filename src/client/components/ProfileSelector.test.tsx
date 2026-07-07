// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProfileSelector } from './ProfileSelector'

afterEach(cleanup)

const profiles = [
  { profileId: 'profile_a', name: 'Alex' },
  { profileId: 'profile_b', name: 'Sarah' },
]

describe('ProfileSelector', () => {
  it('lists local profiles and selects one', () => {
    const onSelect = vi.fn()
    render(
      <ProfileSelector profiles={profiles} onSelect={onSelect} onCreate={() => {}} />,
    )
    expect(screen.getByText(/select or create profile/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Alex (Local)'))
    expect(onSelect).toHaveBeenCalledWith('profile_a')
  })

  it('creates a new profile from the name input', () => {
    const onCreate = vi.fn()
    render(
      <ProfileSelector profiles={profiles} onSelect={() => {}} onCreate={onCreate} />,
    )
    fireEvent.change(screen.getByPlaceholderText(/name/i), {
      target: { value: 'Chris' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create new profile/i }))
    expect(onCreate).toHaveBeenCalledWith('Chris')
  })
})
