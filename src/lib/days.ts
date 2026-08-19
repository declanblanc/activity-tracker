import type { Activity, Completion, DateKey, Entry } from '../data/types.ts'
import type { ScoredPeriod } from './accounting/goals.ts'
import { bucketTotals } from './accounting/totals.ts'
import { dateKey, shiftKey, type TimeWindow } from './time.ts'

/**
 * The one place the two measures meet, and the one place the two calendars meet.
 *
 * `lib/time.ts` *names* days (`DateKey`) and *measures* periods (`TimeWindow`);
 * `lib/accounting/` sums intervals in epoch milliseconds and knows nothing of calendars.
 * This module converts windows into keys and check-offs into numbers, so that everything
 * downstream — the heat grid, `streaks`, the goals panel — sees one shape and has no idea
 * whether it is looking at a habit or a timer.
 *
 * `measure` is branched on exactly once below. Past that line there is no count code path
 * and no duration code path, only amounts.
 */

/**
 * day → amount, for one activity: **1 for a logged day** when it is counted,
 * **milliseconds tracked within that local day** when it is timed. A missing key is zero.
 *
 * An amount rather than a boolean, because a duration day is not binary: two hours towards a
 * four-hour goal is neither nothing nor done, and a number lets `dayCredit` say so while
 * `periodAmounts` still sums it into a week.
 *
 * `days` bounds the duration side only. Completions are already stored one per local day, so
 * there is nothing to bucket and every row handed in is used — which is what lets a count
 * activity have an all-time streak while a timed one is bounded by whatever range was read.
 */
export function dayAmounts(
  activity: Activity,
  entries: Entry[],
  completions: Completion[],
  days: TimeWindow[],
  now: number,
): Map<DateKey, number> {
  if (activity.measure === 'count') {
    return completionAmounts(activity.id, entries, completions, days, now)
  }

  return trackedByDay(activity.id, entries, days, now)
}

/**
 * day → milliseconds tracked within that local day, for one activity. A missing key is zero.
 *
 * Bucketed by `bucketTotals` rather than by splitting intervals here: it already clips an entry
 * that spans midnight, ends an open entry at `now`, and refuses to count the future. All three
 * are tested, and none of them wants a second implementation.
 */
export function trackedByDay(
  activityId: string,
  entries: Entry[],
  days: TimeWindow[],
  now: number,
): Map<DateKey, number> {
  const own = entries.filter((entry) => entry.activityId === activityId)
  return new Map(
    bucketTotals(own, days, now).map((bucket) => [
      // The window's *start*, read as local parts. `window.end` is the next day's midnight
      // and would name tomorrow; `toISOString()` would name tomorrow for every evening in a
      // western zone — the bug `dateKey` exists to prevent.
      dateKey(bucket.window.start),
      bucket.perActivity.get(activityId) ?? 0,
    ]),
  )
}

/**
 * day → 1 for every day of one activity that counts as checked off. A missing key is zero.
 *
 * The check-off half of `dayAmounts`, pulled out because an activity that leads with its timer
 * but also checks off needs the contribution grid on its own — it scores time through
 * `dayAmounts`, so its grid squares come from here instead. See `Activity.display`.
 *
 * **Tracked time checks the day off, and nothing overrules it.** A day you ran the timer on is a
 * day you did the thing, so it fills its square and feeds the streak without also asking for a
 * tap. This is what makes the two axes one habit rather than two ledgers kept side by side, and
 * it holds whichever order the two records arrived in: a `done: false` row on a tracked day is
 * inert, exactly as it is on a day time is added to afterwards. The record that says the day
 * happened is the interval, and the only way to take the day back is to remove it — which is
 * what the dashboard tells the owner when they tap such a square.
 *
 * `done: false` is still this table's tombstone, and still the whole of the un-log gesture on an
 * *untracked* day: a row that says a day was cleared on purpose, distinct from a day never
 * touched. It is only tracked time it cannot outrank.
 *
 * Only `days` bounds the time side; completions are handed in whole. So a tracked day outside
 * the range that was read is not credited here — the same bound `dayAmounts` documents, and the
 * reason a screen derives its grid and its read from one range.
 */
export function completionAmounts(
  activityId: string,
  entries: Entry[],
  completions: Completion[],
  days: TimeWindow[],
  now: number,
): Map<DateKey, number> {
  const amounts = new Map<DateKey, number>()

  // `row.done`, never truthiness: a `false` row is a decision, and it scores as a zero rather
  // than as an absence.
  for (const row of completions) {
    if (row.activityId === activityId && row.done) amounts.set(row.day, 1)
  }
  for (const [day, tracked] of trackedByDay(activityId, entries, days, now)) {
    if (tracked > 0) amounts.set(day, 1)
  }

  return amounts
}

/**
 * One day's amount from each of two activities, for the correlation read in `correlate.ts`.
 *
 * A pair, not two maps: only the days both activities have an amount for say anything about
 * whether they move together, so the intersection is taken once and named here rather than
 * re-derived by every caller.
 */
export type DayPair = {
  day: DateKey
  x: number
  y: number
}

/**
 * Two activities' amounts on the days either of them has anything at all.
 *
 * Bounded by the first and last day *either* map has a non-zero amount for, and zero-filled
 * between: a day one activity happened on and the other did not is exactly the kind of day a
 * correlation is about, so dropping it would leave only the days they agreed and report every
 * pair as moving together. Days outside that span are dropped because neither activity existed
 * yet, and a run of (0, 0) pairs before either began inflates the count without saying anything.
 *
 * Measure-agnostic, like everything downstream of `dayAmounts`: a check-off's 1 and a timer's
 * milliseconds are both just amounts, and `correlate.ts` puts the unit back on at the end.
 */
export function pairDays(x: Map<DateKey, number>, y: Map<DateKey, number>): DayPair[] {
  const touched = [...x, ...y].flatMap(([day, amount]) => (amount > 0 ? [day] : []))
  if (touched.length === 0) return []

  // Keys are zero-padded, so lexical order is chronological order.
  const first = touched.reduce((low, day) => (day < low ? day : low))
  const last = touched.reduce((high, day) => (day > high ? day : high))

  const pairs: DayPair[] = []
  for (let day = first; day <= last; day = shiftKey(day, 1)) {
    pairs.push({ day, x: x.get(day) ?? 0, y: y.get(day) ?? 0 })
  }
  return pairs
}

/**
 * The day amounts summed inside each window, oldest first — exactly `streaks`'s input, and
 * exactly the whole-column total the grid needs to shade a met week.
 *
 * Summing days is *exact* for both measures. Local days partition a local week or month with
 * no gap and no overlap, and one activity's own intervals are disjoint by construction
 * (`saveEntry` folds any overlap a hand edit introduces), so the days of a week add up to
 * the week — including across a DST transition, where the week is 167 or 169 hours long and
 * one of its days is 23 or 25.
 *
 * Every window handed in must be covered by the `days` that built `amounts`. An uncovered
 * day reads as zero, a zero is indistinguishable from a miss, and a streak that is actually
 * intact would break at the edge of the horizon — so both callers derive the two lists from
 * one range.
 */
export function periodAmounts(
  amounts: Map<DateKey, number>,
  windows: TimeWindow[],
): ScoredPeriod[] {
  return windows.map((window) => {
    // `end - 1` is the last millisecond *inside* the half-open window, so its local day is
    // the period's last day. `end` itself belongs to the next period.
    const last = dateKey(window.end - 1)
    let total = 0
    // Keys are zero-padded, so `<=` walks the period in chronological order.
    for (let day = dateKey(window.start); day <= last; day = shiftKey(day, 1)) {
      total += amounts.get(day) ?? 0
    }
    return { window, total }
  })
}
