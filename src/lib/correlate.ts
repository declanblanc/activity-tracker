import type { DateKey, Measure } from '../data/types.ts'
import { pairDays, type DayPair } from './days.ts'
import { formatAmount } from './format.ts'

/**
 * A plain-language read on whether two activities' days move together — "worth a look,"
 * never a claim of cause. Pure arithmetic over `DayPair[]`, with `formatAmount` as the one
 * sanctioned measure-aware step, same as `digest.ts`.
 */

const MIN_POINTS = 5
/** Below this, call it noise rather than dress up a coincidence as a pattern. */
const NEGLIGIBLE_CORRELATION = 0.15

/** Pearson's r: -1 to 1, how linearly two equal-length series move together. */
export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n === 0) return 0

  const meanX = xs.reduce((sum, v) => sum + v, 0) / n
  const meanY = ys.reduce((sum, v) => sum + v, 0) / n

  let numerator = 0
  let spreadX = 0
  let spreadY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    numerator += dx * dy
    spreadX += dx * dx
    spreadY += dy * dy
  }

  const denominator = Math.sqrt(spreadX * spreadY)
  return denominator === 0 ? 0 : numerator / denominator
}

/**
 * A sentence describing `points`, or `null` when there is too little to say anything —
 * too few overlapping days, or a correlation too small to be more than noise.
 *
 * The magnitude comes from splitting `x` at its own median rather than from `r` itself: r
 * says how *linear* the link is, not how *big* it is, and "tended to be 40 more minutes"
 * is a sentence a reader can act on in a way "r = 0.42" is not.
 */
export function describeCorrelation(
  points: DayPair[],
  xLabel: string,
  yLabel: string,
  measureY: Measure,
): string | null {
  if (points.length < MIN_POINTS) return null

  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  if (Math.abs(pearson(xs, ys)) < NEGLIGIBLE_CORRELATION) return null

  const median = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  const below = points.filter((point) => point.x < median).map((point) => point.y)
  const above = points.filter((point) => point.x >= median).map((point) => point.y)
  if (below.length === 0 || above.length === 0) return null

  const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length
  const gap = average(above) - average(below)
  if (gap === 0) return null

  const direction = gap > 0 ? 'more' : 'less'
  return `On days with more ${xLabel}, ${yLabel} tended to be ${formatAmount(measureY, Math.abs(gap))} ${direction} — across ${points.length} overlapping days.`
}

/** One activity offered as a partner for the correlation read. */
export type Candidate = {
  label: string
  measure: Measure
  days: Map<DateKey, number>
}

/**
 * The strongest describable link between `subject` and any of `others`, or `null` when none
 * clears the bar `describeCorrelation` sets.
 *
 * One sentence, not a ranked list. A screen showing every pair it could find would be back to
 * furniture — and the weaker halves of such a list are exactly the coincidences this module
 * exists to refuse. Ranked by |r|, which orders how *linear* each link is; the sentence itself
 * still reports a magnitude, because that is the part a reader can act on.
 */
export function strongestLink(
  subject: { label: string; days: Map<DateKey, number> },
  others: Candidate[],
): string | null {
  let best: { strength: number; sentence: string } | null = null

  for (const other of others) {
    const points = pairDays(subject.days, other.days)
    if (points.length < MIN_POINTS) continue

    const strength = Math.abs(
      pearson(
        points.map((point) => point.x),
        points.map((point) => point.y),
      ),
    )
    if (best !== null && strength <= best.strength) continue

    const sentence = describeCorrelation(points, subject.label, other.label, other.measure)
    if (sentence !== null) best = { strength, sentence }
  }

  return best?.sentence ?? null
}
