import type { Activity, Period } from '../../data/types.ts'
import { streaks, targetAt, type ScoredPeriod } from '../../lib/accounting/goals.ts'
import { formatAmount } from '../../lib/format.ts'
import Meter from '../ui/Meter.tsx'

/**
 * Progress and streaks for the targets belonging to the scale on screen.
 *
 * Both measures, through one code path. A check-off activity's "3 of 5 this week" and a timed
 * one's "2h45m of 4h today" differ only in what `formatAmount` prints — the meter, the verdict,
 * the percentage and the streak are the same arithmetic on the same shape.
 *
 * `historyFor` returns that scale's trailing windows, so a weekly target's streak counts weeks: a
 * target is never scored, or pro-rated, at a scale it was not set at.
 */
export default function Goals({
  activities,
  scale,
  currentAmount,
  historyFor,
  now,
}: {
  activities: Activity[]
  scale: Period
  /** This activity's amount in the viewed period, in its own unit. */
  currentAmount: (activity: Activity) => number
  /** This activity's amounts across the trailing windows of `scale`. */
  historyFor: (activity: Activity) => ScoredPeriod[]
  now: number
}) {
  const scored = activities.flatMap((activity) => {
    const target = activity.archived ? null : targetAt(activity, scale)
    return target === null ? [] : [{ activity, target }]
  })

  if (scored.length === 0) return null

  return (
    <div className="panel mt-4">
      <h2 className="px-4 pt-4 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Goals this {scale}
      </h2>
      <ul className="mt-1 flex flex-col">
        {scored.map(({ activity, target }) => {
          const total = currentAmount(activity)
          const met = total >= target
          const streak = streaks(historyFor(activity), target, now)

          return (
            <li
              key={activity.id}
              className="border-t border-line-subtle px-4 py-3 first:border-t-0"
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {activity.name}
                </span>
                <span className="text-sm text-ink-soft tabular-nums">
                  {formatAmount(activity.measure, total, true)} /{' '}
                  {formatAmount(activity.measure, target)}
                </span>
              </div>
              {/* The one bar in the app whose fullness is a verdict, so the one place a status
                  colour is earned. */}
              <Meter
                fraction={total / target}
                color={met ? 'var(--color-positive)' : activity.color}
              />
              <p className="mt-1 text-xs text-ink-muted">
                {met ? (
                  <span className="text-positive">Goal met</span>
                ) : (
                  // Floored, so an in-progress period reads as partial rather than as failed —
                  // it has not run out of time yet.
                  `${Math.floor((total / target) * 100)}% there`
                )}
                {' · '}
                {streak.current > 0 ? `${streak.current} ${scale} streak` : 'No streak'}
                {streak.longest > streak.current && `, longest ${streak.longest}`}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
