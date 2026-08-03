import type { Activity, Period } from '../../data/types.ts'
import type { TimeWindow } from '../time.ts'

/**
 * Scoring targets, which is mostly a matter of refusing to score them at the wrong period.
 * Pure, like the rest of `lib/accounting/`.
 *
 * Both measures come through here. A count activity's amounts are days and a duration
 * activity's are milliseconds, but a target is just a number to reach in a period, so
 * nothing below needs to know which it is looking at. `lib/days.ts` is where the two are
 * reduced to the common shape.
 */

/**
 * The goal to score at `period`, or `null` when there is none to score.
 *
 * A target is scored **only at its own period**: a 10h/week goal shows progress on the week
 * scale and nothing at all on the day or month scale. Pro-rating would invent a denominator
 * the owner never set ("10h × 4.4 weeks"), and partial weeks at a month's edges make it
 * arbitrary — so the total is still shown at other scales, just without a goal beside it.
 */
export function targetAt(activity: Activity, period: Period): number | null {
  if (!activity.targetAmount || activity.targetPeriod !== period) return null
  return activity.targetAmount
}

/** One period's worth of an activity, as `streaks` wants it. */
export type ScoredPeriod = {
  /** The nominal window — *not* clamped to `now`, or nothing could tell it has closed. */
  window: TimeWindow
  total: number
}

/**
 * How many consecutive periods met the target, ending with the most recent one that counts,
 * and the longest such run anywhere in `periods`.
 *
 * `periods` must be contiguous and oldest-first, all at the target's own period size — which
 * need not be the scale on screen, so a weekly goal's streak counts weeks however Insights
 * is currently set.
 *
 * A period still in progress is **skipped rather than counted as a miss**: a day half-done
 * is not a day missed, and a streak must not read zero every morning until its owner gets
 * round to the day. But one that has *already* met its target counts immediately, because
 * ticking the last box of the day is exactly when the number is supposed to move.
 *
 * That second half is the rule the habit tracker had and the time tracker did not — it used
 * to wait for the period to close, so today's work never showed until tomorrow. The reason
 * given was that a streak should not flicker up and back down inside one period, but a total
 * can only *fall* mid-period through a hand edit or a delete, so the flicker it guarded
 * against costs far less than the number never moving when you tick the box.
 */
export function streaks(
  periods: ScoredPeriod[],
  target: number,
  now: number,
): { current: number; longest: number } {
  let current = 0
  let longest = 0

  for (const period of periods) {
    if (period.window.end > now) {
      // In progress, and so is everything after it.
      if (period.total >= target) {
        current += 1
        longest = Math.max(longest, current)
      }
      break
    }
    current = period.total >= target ? current + 1 : 0
    longest = Math.max(longest, current)
  }

  return { current, longest }
}
