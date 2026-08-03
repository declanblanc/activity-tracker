import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from './Button.tsx'

/**
 * A brief message about something that just happened, with an optional way to act on it.
 *
 * One component for what were two: the time tracker's "that stretch was too short to log"
 * notice and the habit tracker's "deleted — undo" bar. They differ only in whether there is
 * an action beside the text, so the difference is a prop.
 *
 * Positioned by `docked`, because on a phone the bottom edge is the only place a message can
 * sit without covering the thing it is about. `role="status"` so it is announced without
 * stealing focus — the owner has already moved on.
 */
export default function Toast({
  message,
  action,
  onDismiss,
}: {
  message: string
  /** A label and handler for the one thing this message offers, e.g. Undo. */
  action?: { label: string; onAction: () => void }
  onDismiss: () => void
}): ReactNode {
  return (
    <div role="status" className="docked flex items-center gap-3 rounded-xl bg-raised p-3 shadow-lg">
      <p className="min-w-0 flex-1 truncate text-sm text-ink">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onAction}
          className="focus-ring min-h-11 shrink-0 rounded-lg px-2 text-sm font-semibold text-accent-ink"
        >
          {action.label}
        </button>
      )}
      <IconButton label="Dismiss" onClick={onDismiss} className="size-8">
        <X className="size-4" />
      </IconButton>
    </div>
  )
}
