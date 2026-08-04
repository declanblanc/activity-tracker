/**
 * Deleted activities, with a way back for each.
 *
 * A delete only tombstones the row — its entries and check-offs are left intact — so restoring
 * one is a single field flip that brings the whole history back. This is the only place that
 * flip lives; it is reached from Settings rather than the tab bar, because recovering a deleted
 * activity is a rare errand and does not earn a fifth tab.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { RotateCcw, Trash2 } from 'lucide-react'
import { type CSSProperties } from 'react'
import { Link } from 'react-router'
import Button from '../components/ui/Button.tsx'
import EmptyState from '../components/ui/EmptyState.tsx'
import { getDeletedActivities, restoreActivity } from '../data/activities.ts'
import { toDateTimeInput } from '../lib/time.ts'

export default function DeletedActivities() {
  const deleted = useLiveQuery(() => getDeletedActivities(), [])

  // Undefined only until the first read resolves; an empty array is the real "nothing here" state.
  if (!deleted) return null

  return (
    <section className="screen-pad mx-auto w-full max-w-2xl">
      <Link to="/settings" className="focus-ring text-sm text-accent-ink">
        ← Settings
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-ink">Deleted activities</h1>

      {deleted.length === 0 ? (
        <EmptyState icon={<Trash2 className="size-8" />}>
          Nothing deleted. An activity you delete lands here, with its history, until you restore
          it.
        </EmptyState>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {deleted.map((activity) => (
            <li
              key={activity.id}
              className="panel flex items-center gap-3 p-3"
              style={{ '--activity': activity.color } as CSSProperties}
            >
              <span aria-hidden className="size-3 shrink-0 rounded-full bg-[var(--activity)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{activity.name}</p>
                <p className="text-2xs text-ink-muted">
                  Deleted {toDateTimeInput(activity.deletedAt).replace('T', ' ')}
                </p>
              </div>
              <Button onClick={() => void restoreActivity(activity.id)}>
                <RotateCcw className="size-4" aria-hidden />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
