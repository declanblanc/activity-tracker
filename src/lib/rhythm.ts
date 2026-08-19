import type { DateKey, Measure } from '../data/types.ts'
import { formatAmount } from './format.ts'
import { dateKey, type TimeWindow } from './time.ts'

/**
 * The same seven weekdays, averaged over however much history is handed in — the question
 * "which day do I actually do this on" that no panel on Insights could answer.
 *
 * A trend chart shows *when* a run of periods happened; it cannot show that every one of them
 * happened on a Saturday. That shape is the most actionable thing in a year of records and the
 * cheapest to compute: it is the day amounts everything else already reads, grouped by weekday.
 *
 * Pure, and measure-agnostic like the rest of `lib/` — check-offs and milliseconds are both
 * amounts. `describeRhythm` is the one measure-aware step, the same sanctioned exception
 * `formatAmount` and `correlate.ts` already are.
 */

export type WeekdayAmount = {
  /** Sunday 0, matching `weekdayOf` and the heat grid's rows. */
  weekday: number
  total: number
  /** Days of this weekday that closed inside the range, which is what `mean` divides by. */
  days: number
  mean: number
}

/** Weekdays needed before a profile says anything out loud. */
const MIN_SAMPLES = 3
/** A weekday this far from the overall mean is worth naming. */
const NOTABLE = 0.4

/**
 * Sunday first, one entry per weekday, always seven.
 *
 * Only *closed* days count. A day still running has had part of itself to happen, and
 * averaging it in drags its own weekday down every single morning — the same part-against-whole
 * mistake `pace` exists to stop.
 */
export function weekdayProfile(
  amounts: Map<DateKey, number>,
  days: TimeWindow[],
  now: number,
): WeekdayAmount[] {
  const profile: WeekdayAmount[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    total: 0,
    days: 0,
    mean: 0,
  }))

  for (const day of days) {
    if (day.end > now) continue
    const slot = profile[new Date(day.start).getDay()]
    slot.total += amounts.get(dateKey(day.start)) ?? 0
    slot.days += 1
  }

  for (const slot of profile) {
    slot.mean = slot.days === 0 ? 0 : slot.total / slot.days
  }

  return profile
}

/**
 * The weekday that stands furthest from the rest, or `null` when none of them does.
 *
 * Named rather than left for the reader to spot in the bars: a column that is visibly shorter
 * is only a fact once someone says which day it is and how much shorter. Silent when the
 * history is too thin to mean anything, or when the week is level — a flat week is not a
 * finding, and dressing one up as one is what made every other panel here furniture.
 */
export function describeRhythm(profile: WeekdayAmount[], measure: Measure): string | null {
  if (profile.some((slot) => slot.days < MIN_SAMPLES)) return null

  const overall = profile.reduce((sum, slot) => sum + slot.mean, 0) / profile.length
  if (overall <= 0) return null

  const quietest = profile.reduce((low, slot) => (slot.mean < low.mean ? slot : low))
  const busiest = profile.reduce((high, slot) => (slot.mean > high.mean ? slot : high))
  const downBy = (overall - quietest.mean) / overall
  const upBy = (busiest.mean - overall) / overall

  if (Math.max(downBy, upBy) < NOTABLE) return null

  const [slot, word] = downBy >= upBy ? [quietest, 'quietest'] : [busiest, 'strongest']
  return `${weekdayName(slot.weekday)} is your ${word} day — ${formatAmount(measure, slot.mean)} against a ${formatAmount(measure, overall)} average.`
}

/**
 * The weekday's name in the reader's locale.
 *
 * Any Sunday will do as the reference date; 2024-01-07 is one, and reading it back through
 * local parts keeps it Sunday in every zone.
 */
function weekdayName(weekday: number): string {
  const sunday = new Date(2024, 0, 7)
  sunday.setDate(sunday.getDate() + weekday)
  return sunday.toLocaleDateString(undefined, { weekday: 'long' })
}
