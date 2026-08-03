import { X } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Activity } from '../data/types.ts'
import { formatDuration } from '../lib/format.ts'
import { fromDateTimeInput } from '../lib/time.ts'
import EntryForm from './EntryForm.tsx'
import type { Draft } from './entryDraft.ts'
import { IconButton } from './ui/Button.tsx'

/**
 * One entry, in a sheet.
 *
 * The same drawer `ActivitySheet` uses, for the same reason: on the Today timeline there is no row
 * for a form to open *under*, so an inline form had to appear above the timeline instead — far from
 * the bar it was about, pushing the whole day down as it opened, and offering no heading to say
 * which stretch was being edited.
 *
 * In a list — an activity sheet's own history — the inline form is still right, because the row it
 * sits under is the context. This is for the places that have no row.
 */
export default function EntrySheet({
  draft,
  activities,
  onChange,
  onClose,
}: {
  draft: Draft
  activities: Activity[]
  onChange: (draft: Draft) => void
  onClose: () => void
}) {
  const activity = activities.find((option) => option.id === draft.activityId)
  const length = fromDateTimeInput(draft.end) - fromDateTimeInput(draft.start)

  return (
    <div
      style={{ '--activity': activity?.color ?? 'var(--color-orphan)' } as CSSProperties}
      className="flex min-h-full flex-col bg-surface p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
          style={{ backgroundColor: activity?.color ?? 'var(--color-orphan)' }}
        >
          {activity?.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold break-words text-ink">
            {draft.id ? (activity?.name ?? 'Deleted activity') : 'New entry'}
          </h2>
          {/* The length, because it is the number a mis-recorded stretch is usually spotted by, and
              the two datetime inputs below state it only implicitly.

              An empty end on an entry that is already open is not a half-typed field — it is what
              "still running" looks like, and the form says so beneath. Only a genuinely unreadable
              pair falls through to the prompt. */}
          <p className="mt-0.5 text-sm text-ink-muted tabular-nums">
            {draft.wasOpen && draft.end === ''
              ? 'Running'
              : Number.isFinite(length) && length > 0
                ? formatDuration(length)
                : 'Set a start and end'}
          </p>
        </div>
        <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-1 size-9">
          <X className="size-5" />
        </IconButton>
      </div>

      {/* No `panel`: the sheet is already a surface. */}
      <EntryForm
        className="mt-5"
        draft={draft}
        activities={activities}
        onChange={onChange}
        onClose={onClose}
      />
    </div>
  )
}
