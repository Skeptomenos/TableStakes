import { useState } from 'react'

import type { ProfileInfo } from '../api'

export interface ProfileSelectorProps {
  profiles: ProfileInfo[]
  onSelect(profileId: string): void
  onCreate(name: string): void
}

/** Host-owned local profiles: select or create, never log in (SPEC.md). */
export function ProfileSelector({
  profiles,
  onSelect,
  onCreate,
}: ProfileSelectorProps) {
  const [name, setName] = useState('')

  return (
    <section className="card" aria-label="Profiles">
      <h2 className="card__title">Select or Create Profile</h2>
      <ul className="profile-list">
        {profiles.map((profile) => (
          <li key={profile.profileId}>
            <button
              type="button"
              className="profile-list__row"
              onClick={() => onSelect(profile.profileId)}
            >
              {profile.name} (Local)
            </button>
          </li>
        ))}
      </ul>
      <div className="profile-create">
        <input
          className="input"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
        />
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            const trimmed = name.trim()
            if (trimmed.length > 0) {
              onCreate(trimmed)
              setName('')
            }
          }}
        >
          Create New Profile
        </button>
      </div>
    </section>
  )
}
