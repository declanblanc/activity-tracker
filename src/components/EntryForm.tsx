import { useState } from 'react'
import Button from './ui/Button.tsx'
import { saveEntry, softDeleteEntry } from '../data/entries.ts'
import type { Activity } from '../data/types.ts'
import { toInput, type Draft } from './entryDraft.ts'

/**
 * One entry, edited or created. The same form does both, because "add a forgotten
 * entry" and "fix a recorded one" differ only in whether an id comes with it.
 *
 * Nothing is validated here: `saveEntry` is the trust boundary, and its messages are
 * written for the user. The form's only job is to render what it throws.
 *
 * It lives here rather than inside either caller because two places correct the record. An
 * activity's sheet opens it from a row in that activity's history; Today opens it from a bar on
 * the timeline, which is where a wrong entry is usually *noticed*.
 */
export default function EntryForm({
  draft,
  activities,
  onChange,
  onClose,
  className = '',
}: {
  draft: Draft
  activities: Activity[]
  onChange: (draft: Draft) => void
  onClose: () => void
  /**
   * The surface and the spacing are the caller's. A form tucked under a list row wants its own
   * `panel`; the same form filling a sheet is already on one, and a panel inside a panel reads as a
   * second card for no reason.
   */
  className?: string
}) {
  const [error, setError] = useState<string | null>(null)
  // Held in a const so the delete handler keeps the narrowing the JSX guard gives it.
  const entryId = draft.id

  const submit = async () => {
    try {
      await saveEntry(toInput(draft))
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className={`flex flex-col gap-3 ${className}`}
    >
      <label className="flex flex-col gap-1 text-sm text-ink-soft">
        Activity
        <select
          value={draft.activityId}
          onChange={(event) => onChange({ ...draft, activityId: event.target.value })}
          className="rounded-lg bg-canvas px-3 py-2 text-base text-ink"
        >
          {/* An empty first option so "no activity chosen" is a state the form can be
              in, and `saveEntry` is the one that says so. */}
          <option value="">Choose an activity…</option>
          {activities.map((activity) => (
            // Archived activities are offered: correcting old data is the whole point.
            <option key={activity.id} value={activity.id}>
              {activity.name}
              {activity.archived ? ' (archived)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-soft">
        Start
        <input
          type="datetime-local"
          value={draft.start}
          onChange={(event) => onChange({ ...draft, start: event.target.value })}
          className="rounded-lg bg-canvas px-3 py-2 text-base text-ink"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-soft">
        End
        <input
          type="datetime-local"
          value={draft.end}
          onChange={(event) => onChange({ ...draft, end: event.target.value })}
          className="rounded-lg bg-canvas px-3 py-2 text-base text-ink"
        />
        {draft.wasOpen && (
          <span className="text-xs text-ink-muted">
            Leave empty to keep this entry running.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-soft">
        Note
        <input
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          placeholder="optional"
          className="rounded-lg bg-canvas px-3 py-2 text-base text-ink"
        />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" className="flex-1">
          Save
        </Button>
        {entryId && (
          <Button variant="danger" onClick={() => confirmDelete(entryId, onClose)}>
            Delete
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}

function confirmDelete(id: string, onDeleted: () => void) {
  // ponytail: window.confirm, as on the Activities screen. The platform dialog is
  // already accessible and dismissible, and a delete is rare enough not to style.
  if (confirm('Delete this entry? Totals will stop counting it.')) {
    void softDeleteEntry(id).then(onDeleted)
  }
}
