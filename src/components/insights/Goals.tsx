import type { Activity, Period } from '../../data/types.ts'
import { streaks, targetAt, type ScoredPeriod } from '../../lib/accounting/goals.ts'
import { formatAmount } from '../../lib/format.ts'
import { onPace, type Pace } from '../../lib/pace.ts'
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
 *
 * The pace verdict is the one thing here that is about *time remaining* rather than about the
 * total: "37% there" on a Tuesday and "37% there" on a Saturday are the same number and not the
 * same situation, and only one of them is worth acting on.
 */
export default function Goals({
  activities,
  scale,
  currentAmount,
  historyFor,
  paceFor,
  daysLeft,
  now,
}: {
  activities: Activity[]
  scale: Period
  /** This activity's amount in the viewed period, in its own unit. */
  currentAmount: (activity: Activity) => number
  /** This activity's amounts across the trailing windows of `scale`. */
  historyFor: (activity: Activity) => ScoredPeriod[]
  /** This activity's progress through the viewed period. */
  paceFor: (activity: Activity) => Pace
  /** Days of the viewed period still to run. Zero once it has closed. */
  daysLeft: number
  now: number
}) {
  const scored = activities.flatMap((activity) => {
    const target = activity.archived ? null : targetAt(activity, scale)
    return target === null ? [] : [{ activity, target }]
  })

  if (scored.length === 0) return null

  const met = scored.filter(({ activity, target }) => currentAmount(activity) >= target).length

  return (
    <div className="panel mt-4">
      <h2 className="flex items-baseline gap-2 px-4 pt-4 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Goals this {scale}
        <span className="ml-auto font-normal tracking-normal normal-case tabular-nums">
          {/* The days remaining belong to the period, not to any one goal, so they are said
              once here rather than repeated down every row. */}
          {daysLeft > 0 && `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left · `}
          <span className={met > 0 ? 'text-positive' : undefined}>{met}</span> of {scored.length} met
        </span>
      </h2>
      <ul className="mt-1 flex flex-col">
        {scored.map(({ activity, target }) => {
          const total = currentAmount(activity)
          const reached = total >= target
          const streak = streaks(historyFor(activity), target, now)
          const pace = paceFor(activity)
          // Only where there is a period left to run and a closed day to judge it by. A day
          // scale has neither, so it shows the percentage alone rather than a verdict that
          // would read "behind" at one minute past midnight.
          const verdict =
            reached || !pace.inProgress || pace.daysClosed === 0
              ? null
              : onPace(pace, target)
                ? 'on pace'
                : 'behind pace'

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
                color={reached ? 'var(--color-positive)' : activity.color}
              />
              <p className="mt-1 text-xs text-ink-muted">
                {reached ? (
                  <span className="text-positive">Goal met</span>
                ) : (
                  // Floored, so an in-progress period reads as partial rather than as failed —
                  // it has not run out of time yet.
                  `${Math.floor((total / target) * 100)}% there`
                )}
                {verdict && (
                  <>
                    {' · '}
                    <span className={verdict === 'on pace' ? 'text-positive' : 'text-ink-soft'}>
                      {verdict}
                    </span>
                  </>
                )}
                {!reached && pace.inProgress && (
                  <>
                    {' · '}
                    {formatAmount(activity.measure, target - total)} to go
                  </>
                )}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
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
