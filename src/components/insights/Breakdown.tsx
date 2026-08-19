import type { Activity, Period } from '../../data/types.ts'
import type { PeriodTotals } from '../../lib/accounting/totals.ts'
import { formatDuration } from '../../lib/format.ts'
import type { Pace } from '../../lib/pace.ts'
import Meter from '../ui/Meter.tsx'
import Delta from './Delta.tsx'

/**
 * Time per activity for the viewed period, longest first.
 *
 * These sum to more than the tracked union whenever timers overlapped, and that is
 * correct: the two numbers answer different questions and are not reconciled. The share
 * beside each total is of the period, the same denominator the meter uses.
 */
export default function Breakdown({
  current,
  activities,
  scale,
  paceFor,
}: {
  current: PeriodTotals
  activities: Activity[]
  scale: Period
  /** One activity's pace across the viewed period, for the like-for-like delta. */
  paceFor: (activityId: string) => Pace
}) {
  // The clamped period: the same denominator the coverage panel and the Tracker's day
  // summary use, so a bar means the same thing everywhere it appears.
  const period = current.length
  const byId = new Map(activities.map((activity) => [activity.id, activity]))
  const rows = [...current.perActivity]
    .map(([activityId, total]) => ({
      activityId,
      total,
      activity: byId.get(activityId),
    }))
    .sort((a, b) => b.total - a.total)

  if (rows.length === 0) return null

  return (
    <div className="panel mt-4">
      <h2 className="px-4 pt-4 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Where the time went
      </h2>
      {/* One panel of rows rather than a card each: twenty identical cards gave the eye
          nowhere to start, and the group is one thing. */}
      <ul className="mt-1 flex flex-col">
        {rows.map((row) => (
          <li key={row.activityId} className="border-t border-line-subtle px-4 py-3 first:border-t-0">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {row.activity?.name ?? 'Deleted activity'}
              </span>
              <span className="text-sm text-ink-soft tabular-nums">
                {formatDuration(row.total)}
                {period > 0 && (
                  <span className="text-ink-muted"> · {Math.round((row.total / period) * 100)}%</span>
                )}
              </span>
            </div>
            {/* Against the period, not against the biggest row. Scaling to the largest
                total made the top row's bar permanently full, which reads as a goal met —
                the one thing a full bar should mean. */}
            <Meter
              fraction={period > 0 ? row.total / period : 0}
              color={row.activity?.color ?? 'var(--color-orphan)'}
            />
            <Delta pace={paceFor(row.activityId)} scale={scale} />
          </li>
        ))}
      </ul>
    </div>
  )
}
