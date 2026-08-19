import type { Activity, Period } from '../../data/types.ts'
import { streaks, targetAt, type ScoredPeriod } from '../../lib/accounting/goals.ts'
import type { PeriodTotals } from '../../lib/accounting/totals.ts'
import { formatDuration } from '../../lib/format.ts'
import Meter from '../ui/Meter.tsx'
import Stat from '../ui/Stat.tsx'
import Delta from './Delta.tsx'
import RunningTimer from './RunningTimer.tsx'

/**
 * The viewed period for the one activity on screen.
 *
 * The two measures genuinely have different things to say here, so this is the one panel that
 * branches. A timed activity reports its time and what share of the tracked union it accounts
 * for; a check-off reports its streaks, because "share of tracked time" is meaningless for
 * something that takes no measurable time.
 *
 * The share is measured against the tracked union rather than the period, so it answers "of the
 * time I accounted for, how much was this". It can reach 100% for an activity that ran alongside
 * others the whole time — overlapping timers each own their time in full, and these shares are
 * not meant to add up to 100 across activities.
 */
export default function FocusSummary({
  activity,
  current,
  previous,
  scale,
  runningSince,
  history,
  now,
}: {
  activity: Activity
  current: PeriodTotals
  previous: PeriodTotals
  scale: Period
  /** When the running stretch began, if this activity's timer is going. */
  runningSince?: number
  /** This activity's amounts at its own target period, for the streaks. */
  history: ScoredPeriod[]
  now: number
}) {
  if (activity.measure === 'count') {
    const target = targetAt(activity, activity.targetPeriod ?? 'day') ?? 1
    const { current: streak, longest } = streaks(history, target, now)
    const unit = activity.targetPeriod === 'week' ? 'weeks' : 'days'
    const done = history.reduce((sum, period) => sum + period.total, 0)

    return (
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Current" value={streak} unit={unit} />
        <Stat label="Longest" value={longest} unit={unit} />
        <Stat label="Logged" value={done} unit="days" />
      </dl>
    )
  }

  const total = current.perActivity.get(activity.id) ?? 0
  const share = current.tracked > 0 ? total / current.tracked : 0

  return (
    <div className="mt-4 flex gap-3">
      <div className="panel flex-1 p-3">
        <p className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">Time</p>
        <p className="text-xl font-semibold text-ink tabular-nums">{formatDuration(total)}</p>
        {/* Above the delta rather than below it: it explains why the number over it is still
            moving, which the comparison to last week does not. */}
        {runningSince !== undefined && <RunningTimer startedAt={runningSince} />}
        <Delta
          from={previous.perActivity.get(activity.id) ?? 0}
          to={total}
          label={`vs previous ${scale}`}
        />
      </div>
      <div className="panel flex-1 p-3">
        <p className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">
          Share of tracked
        </p>
        <p className="text-xl font-semibold text-ink tabular-nums">{Math.round(share * 100)}%</p>
        <Meter fraction={share} color={activity.color} />
      </div>
    </div>
  )
}
