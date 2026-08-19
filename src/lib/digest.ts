import type { Activity, Measure, Period } from '../data/types.ts'
import type { ScoredPeriod } from './accounting/goals.ts'
import { formatDuration } from './format.ts'

/**
 * The short, ranked highlights atop the unfocused Insights screen — a handful of sentences
 * picked out of numbers every panel below already shows, so a quiet period and a notable one
 * no longer render as the identical page.
 *
 * Pure over already-scored periods, like the rest of `lib/`: no Dexie, no React. The one
 * measure-aware step is `formatDuration`/`moreLabel`, the same sanctioned exception
 * `formatAmount` already is — everything upstream of this file has erased which axis an
 * activity is scored on.
 */

export type Highlight = { icon: string; text: string }

export type Goal = {
  target: number
  /** This period's amount so far, in the activity's own unit. */
  total: number
  /** The streak reaching into this period — *not* counting it, so it is what is "at stake". */
  streak: { current: number; longest: number }
}

export type ActivityDigestInput = {
  activity: Activity
  /** Present only when the activity has a goal at the scale on screen. */
  goal?: Goal
  /**
   * Trailing periods at the scale on screen, oldest first, ending with the one being
   * browsed to — the same series the trend chart draws, reused rather than re-read.
   */
  trend: ScoredPeriod[]
}

type Ranked = Highlight & { rank: number; magnitude: number }

/** A period at least this far from its trailing average is worth mentioning. */
const MOVER_THRESHOLD = 0.3
/** Periods needed before the one being compared, so a mover is never just noise. */
const MIN_BASELINE_PERIODS = 3

/** The top `limit` highlights across every activity, most actionable first. */
export function buildDigest(
  inputs: ActivityDigestInput[],
  scale: Period,
  now: number,
  limit = 4,
): Highlight[] {
  return inputs
    .flatMap((input) => forActivity(input, scale, now))
    .sort((a, b) => a.rank - b.rank || b.magnitude - a.magnitude)
    .slice(0, limit)
    .map(({ icon, text }) => ({ icon, text }))
}

function forActivity(
  { activity, goal, trend }: ActivityDigestInput,
  scale: Period,
  now: number,
): Ranked[] {
  const highlights: Ranked[] = []

  if (goal) {
    const met = goal.total >= goal.target
    // Unmet, with a streak reaching into this period: the one thing today changes if it
    // stays unmet is that streak, which is the whole reason to lead with it.
    if (!met && goal.streak.current > 0) {
      highlights.push({
        icon: '⏳',
        rank: 0,
        magnitude: goal.streak.current,
        text: `${activity.name} needs ${moreLabel(activity.measure, goal.target - goal.total)} to keep a ${goal.streak.current}-${scale} streak.`,
      })
    }
    // Met, and — because `streaks` counts a period the moment it is met, not when it closes
    // — already the longest run on record: worth saying now rather than waiting to notice.
    if (met && goal.streak.current > 1 && goal.streak.current >= goal.streak.longest) {
      highlights.push({
        icon: '🔥',
        rank: 1,
        magnitude: goal.streak.current,
        text: `${activity.name}'s streak is at ${goal.streak.current} ${scale}s, its longest yet.`,
      })
    }
  }

  const mover = findMover(activity, trend, now, scale)
  if (mover) highlights.push(mover)

  return highlights
}

/**
 * The most recent *closed* period against the average of the ones before it.
 *
 * Never the period still being browsed to: an in-progress week read against a finished
 * week's worth of average is a comparison against the clock, not against the activity, and
 * would report a "40% drop" on the first day of every week without fail.
 */
function findMover(
  activity: Activity,
  trend: ScoredPeriod[],
  now: number,
  scale: Period,
): Ranked | null {
  const closed = trend.filter((period) => period.window.end <= now)
  if (closed.length < MIN_BASELINE_PERIODS + 1) return null

  const last = closed[closed.length - 1]
  const baseline = closed.slice(0, -1)
  const mean = baseline.reduce((sum, period) => sum + period.total, 0) / baseline.length
  if (mean <= 0) return null

  const change = (last.total - mean) / mean
  if (Math.abs(change) < MOVER_THRESHOLD) return null

  const percent = Math.round(Math.abs(change) * 100)
  const direction = change < 0 ? 'down' : 'up'
  return {
    icon: change < 0 ? '📉' : '📈',
    rank: 2,
    magnitude: Math.abs(change),
    text: `${activity.name} was ${direction} ${percent}% last ${scale} vs its ${baseline.length}-${scale} average.`,
  }
}

/** "2h 30m more" for a duration, "2 more days" for a count. */
function moreLabel(measure: Measure, amount: number): string {
  if (measure === 'duration') return `${formatDuration(amount)} more`
  const days = Math.max(0, Math.round(amount))
  return days === 1 ? '1 more day' : `${days} more days`
}
