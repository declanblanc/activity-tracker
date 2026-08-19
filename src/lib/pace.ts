import type { DateKey } from '../data/types.ts'
import { dateKey, dayWindowsIn, type TimeWindow } from './time.ts'

/**
 * How far into a period we are, and what that makes of the numbers inside it.
 *
 * A period still running was being compared against a period that had finished — so every
 * delta on Insights reported a collapse for the first six days of every week and the first
 * four weeks of every month, and the mean line the current bar was drawn against included
 * the current bar. Both are the same mistake: a part measured against a whole.
 *
 * **The comparison is over whole closed days, and only those.** A day is the finest amount
 * `dayAmounts` names, so pairing a day in progress against a day in full would reintroduce
 * exactly the error this exists to remove. On the day scale nothing has closed yet and
 * there is no comparison to make — `comparison` is `null` and a caller shows the goal
 * instead of a delta, which is honest rather than wrong.
 *
 * Pure over a day-amount map, like the rest of `lib/`: it never sees an activity and so has
 * no `measure` to branch on. Check-offs and milliseconds both arrive as amounts.
 */
export type Pace = {
  /** Whether `now` falls inside the window. */
  inProgress: boolean
  /** Days of the window that have finished. Zero for any day still running. */
  daysClosed: number
  daysTotal: number
  /** Every day the window has, the one in progress included. This is the number on screen. */
  soFar: number
  /**
   * The window and the one before it, each summed over the same count of leading days.
   * `null` until a day of the window has closed.
   */
  comparison: { then: number; now: number } | null
  /** What the window reaches if its remaining days go like its closed ones. `null` with no closed day. */
  projected: number | null
}

export function pace(
  amounts: Map<DateKey, number>,
  window: TimeWindow,
  previous: TimeWindow,
  now: number,
): Pace {
  const days = dayWindowsIn(window)
  const previousDays = dayWindowsIn(previous)
  const sum = (list: TimeWindow[]) =>
    list.reduce((total, day) => total + (amounts.get(dateKey(day.start)) ?? 0), 0)

  const soFar = sum(days)
  const daysClosed = days.filter((day) => day.end <= now).length
  const shape = {
    inProgress: window.start <= now && now < window.end,
    daysClosed,
    daysTotal: days.length,
    soFar,
  }

  if (daysClosed === 0) return { ...shape, comparison: null, projected: null }

  // Leading days by index, not by date: a 28-day February against a 31-day January pairs
  // the first day with the first, and `slice` simply runs out at the shorter one's end.
  const comparison = {
    now: sum(days.slice(0, daysClosed)),
    then: sum(previousDays.slice(0, daysClosed)),
  }

  return {
    ...shape,
    comparison,
    // Never below what is already recorded. The rate comes from closed days alone, which
    // ignores the day in progress — and by the evening that day is most of what was done.
    projected: Math.max(soFar, (comparison.now / daysClosed) * days.length),
  }
}

/**
 * Whether a window is keeping up with a target, judged at the start of the day in progress:
 * by day three of a week you are expected to have two days' worth, not three.
 *
 * Forgiving on purpose — "behind" should mean the period has already slipped, not that it
 * is early in the morning. A window with one day in it has nothing closed and so is never
 * behind; callers show the goal's own percentage there instead.
 */
export function onPace({ soFar, daysClosed, daysTotal }: Pace, target: number): boolean {
  if (daysTotal === 0) return true
  return soFar >= target * (daysClosed / daysTotal)
}
