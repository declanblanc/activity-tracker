import type { Activity, Completion, Entry, Period } from '../data/types.ts'
import { streaks, targetAt } from './accounting/goals.ts'
import { dayAmounts, periodAmounts } from './days.ts'
import { dayWindow, dayWindowsIn, parseKey, trailingWindows } from './time.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const DAYS_PER_PERIOD: Record<Period, number> = { day: 1, week: 7, month: 31 }

export type PersonalBests = {
  /** The single best period, at the activity's own scale (its `targetPeriod`, or a day). */
  bestPeriod: number
  lifetimeTotal: number
  /** Absent when the activity has no target — there is nothing to have kept a streak on. */
  longestStreak?: number
}

/**
 * The record book for one activity, read once over its *entire* history rather than the
 * bounded window the rest of Insights shares.
 *
 * `STREAK_PERIODS` in `screens/Insights.tsx` deliberately caps every streak on screen at
 * twelve trailing periods, so the one shared read covers all of them. An all-time
 * superlative has no such bound by definition — "longest ever" over twelve weeks is just
 * "longest," a different claim — so this runs its own unbounded read, and only when a
 * reader actually asks to see it: on demand, not folded into the screen's shared query.
 */
export function personalBests(
  activity: Activity,
  entries: Entry[],
  completions: Completion[],
  now: number,
): PersonalBests | null {
  const firstMoment = earliestMoment(activity, entries, completions)
  if (firstMoment === null) return null

  const period = activity.targetPeriod ?? 'day'
  const days = dayWindowsIn({ start: dayWindow(firstMoment).start, end: now })
  const amounts = dayAmounts(activity, entries, completions, days, now)
  const lifetimeTotal = sumOf([...amounts.values()])

  // However many periods separate the first record from now, plus one for the partial
  // period at either end — an overshoot here just adds empty leading windows, which
  // affect neither the best single period nor a streak (a streak resets on a miss, and
  // an untouched period is one).
  const spanDays = Math.max(1, Math.ceil((now - firstMoment) / DAY_MS) + 1)
  const periodCount = Math.ceil(spanDays / DAYS_PER_PERIOD[period]) + 1
  const scored = periodAmounts(amounts, trailingWindows(now, period, periodCount))
  const bestPeriod = scored.reduce((max, entry) => Math.max(max, entry.total), 0)

  // A count activity with no target still has the implicit "every day" goal its streak
  // already reads by, matching the same default `FocusSummary` falls back to for one.
  const target = activity.measure === 'count' ? targetAt(activity, period) ?? 1 : targetAt(activity, period)
  const longestStreak = target === null ? undefined : streaks(scored, target, now).longest

  return { bestPeriod, lifetimeTotal, longestStreak }
}

/** The earliest moment this activity has anything recorded, or `null` if it has nothing. */
function earliestMoment(activity: Activity, entries: Entry[], completions: Completion[]): number | null {
  if (activity.measure === 'count') {
    const days = completions
      .filter((completion) => completion.activityId === activity.id && completion.done)
      .map((completion) => parseKey(completion.day).getTime())
    return minOf(days)
  }
  const starts = entries
    .filter((entry) => entry.activityId === activity.id)
    .map((entry) => entry.startedAt)
  return minOf(starts)
}

/** Avoids spreading a potentially years-long array into `Math.min`. */
function minOf(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((min, value) => Math.min(min, value))
}

function sumOf(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
