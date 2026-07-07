import type { ReactNode } from 'react'

export interface ConfirmSheetProps {
  title: string
  detail: ReactNode
  confirmLabel: string
  onConfirm(): void
  onCancel(): void
  danger?: boolean
}

/** Bottom confirmation sheet for destructive or high-value actions. */
export function ConfirmSheet({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
}: ConfirmSheetProps) {
  return (
    <div className="confirm-sheet" role="dialog" aria-label={title}>
      <div className="confirm-sheet__card">
        <h3 className="confirm-sheet__title">{title}</h3>
        <p className="confirm-sheet__detail">{detail}</p>
        <div className="confirm-sheet__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'button button--danger' : 'button button--primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
