import type { ReactNode } from 'react'

/**
 * What a screen says when there is nothing to show yet.
 *
 * Every one of these used to be a bare centred sentence — accurate, and a dead end. The
 * screen that has nothing on it is the screen with the most room for the action that
 * would fix that, so the action comes with the sentence.
 */
export default function EmptyState({
  icon,
  children,
  action,
}: {
  icon: ReactNode
  children: ReactNode
  /** The way out. Omitted only where the wait is time, not a missing action. */
  action?: ReactNode
}) {
  return (
    <div className="mt-10 flex flex-col items-center gap-3 px-6 text-center">
      <span aria-hidden className="text-ink-subtle">
        {icon}
      </span>
      <p className="max-w-xs text-sm text-ink-muted">{children}</p>
      {action}
    </div>
  )
}
