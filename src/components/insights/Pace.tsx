import type { Activity } from '../../data/types.ts'
import { formatDuration } from '../../lib/format.ts'
import Meter from '../ui/Meter.tsx'

/**
 * Hours tracked against hours owed, for the one time-based goal on screen.
 *
 * The question the rest of Insights never answers: across the span in view — this week, or the
 * whole life of the activity — am I ahead of the commitment or behind it? A 40h/week goal three
 * weeks in owes 120h; whether the reality is 130h or 95h is the difference between a buffer to
 * coast on and a debt to catch up. The `owed` amount prorates continuously (`expectedSoFar` in
 * `lib/owed.ts`), so the delta is live rather than a step that only moves when a week closes.
 *
 * Duration goals only. A check-off's "days owed" can never be caught up — miss a day and you are
 * short forever — so the caller renders this for `measure === 'duration'` with a target and
 * nothing else. It also renders nothing while `expected` is zero: a span with no elapsed time yet
 * has no owe to be measured against, and "0m behind" is a verdict about nothing.
 *
 * The one coloured verdict here is earned the way `Goals`' meter earns its green: a target is the
 * single place the app knows which direction is good. Ahead is `positive`; behind is the
 * activity's own colour, not a danger red — being behind on a goal is not an error.
 *
 * ponytail: `owed` is the *current* goal rate applied to all of history — change 40h/week to 30 and
 * last month's owe recomputes at 30. No goal history is stored to do otherwise, and the whole-DB
 * blob sync (no per-record migrations) is why none will be; if per-period historical rates ever
 * matter, they need a stored goal-change log, not a field on `Activity`.
 */
export default function Pace({
  activity,
  tracked,
  expected,
  spanLabel,
}: {
  activity: Activity
  /** Time tracked over the span, in ms. */
  tracked: number
  /** Time owed over the span by now, in ms. */
  expected: number
  /** What the span is called: "This week", a date range, or "Since Jul 3". */
  spanLabel: string
}) {
  if (expected <= 0) return null

  const delta = tracked - expected
  const ahead = delta >= 0
  const magnitude = formatDuration(Math.abs(delta))
  // formatDuration rounds to whole minutes, so anything under half a minute either way reads as
  // level rather than as a hair ahead or behind.
  const onTrack = magnitude === '0m'

  return (
    <div className="panel mt-4 p-4">
      <h2 className="flex items-baseline gap-2 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Pace
        <span className="ml-auto font-normal tracking-normal normal-case text-ink-soft">
          {spanLabel}
        </span>
      </h2>
      <p
        className={`mt-2 text-xl font-semibold tabular-nums ${
          onTrack ? 'text-ink' : ahead ? 'text-positive' : 'text-ink'
        }`}
      >
        {onTrack ? 'On track' : `${magnitude} ${ahead ? 'ahead' : 'behind'}`}
      </p>
      <Meter
        fraction={tracked / expected}
        color={ahead ? 'var(--color-positive)' : activity.color}
      />
      <p className="mt-1 text-xs text-ink-muted">
        <span className="text-ink-soft tabular-nums">{formatDuration(tracked)}</span> tracked ·{' '}
        <span className="text-ink-soft tabular-nums">{formatDuration(expected)}</span> owed
      </p>
    </div>
  )
}
