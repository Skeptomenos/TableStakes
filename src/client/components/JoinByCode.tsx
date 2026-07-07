import { useState } from 'react'

export interface JoinByCodeProps {
  onJoin(code: string): void
}

/**
 * Manual game-code entry (DESIGN.md Join Game): players without the QR or
 * URL type the five-digit code. Direct URL/code joining is the canonical
 * path; this input must never demand more than the code.
 */
export function JoinByCode({ onJoin }: JoinByCodeProps) {
  const [code, setCode] = useState('')
  const valid = /^\d{5}$/.test(code)

  return (
    <form
      className="join-code"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onJoin(code)
      }}
    >
      <label className="field join-code__field">
        <span>Game code</span>
        <input
          className="input join-code__input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="48317"
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, '').slice(0, 5))
          }
        />
      </label>
      <button
        type="submit"
        className="button button--primary join-code__submit"
        disabled={!valid}
      >
        Join
      </button>
    </form>
  )
}
