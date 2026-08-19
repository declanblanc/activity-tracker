/**
 * Where one number falls among others — what turns "+3h15m vs last week" into "...and
 * that's higher than 10 of your last 11 weeks." Pure, like the rest of `lib/accounting/`:
 * a plain array of numbers in, a fraction out.
 */

/** The fraction of `series` strictly below `value` — how good a showing `value` is. */
export function percentileRank(series: number[], value: number): number {
  if (series.length === 0) return 0
  const below = series.filter((entry) => entry < value).length
  return below / series.length
}
