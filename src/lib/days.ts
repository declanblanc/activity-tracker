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
    return new Map(
      completions
        // `done === true`, never truthiness. A `done: false` row is a decision that was
        // recorded — an un-log — and reading it as absence is how a cleared day comes back
        // to life. It contributes 0, which breaks a streak exactly as a missing row does.
        .filter((row) => row.activityId === activity.id && row.done)
        .map((row) => [row.day, 1]),
    )
  }

  const own = entries.filter((entry) => entry.activityId === activity.id)
  // Bucketed by `bucketTotals` rather than by splitting intervals here: it already clips an
  // entry that spans midnight, ends an open entry at `now`, and refuses to count the future.
  // All three are tested, and none of them wants a second implementation.
  return new Map(
    bucketTotals(own, days, now).map((bucket) => [
      // The window's *start*, read as local parts. `window.end` is the next day's midnight
      // and would name tomorrow; `toISOString()` would name tomorrow for every evening in a
      // western zone — the bug `dateKey` exists to prevent.
      dateKey(bucket.window.start),
      bucket.perActivity.get(activity.id) ?? 0,
    ]),
  )
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
