import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Period } from '../../data/types.ts'
import { formatDuration } from '../../lib/format.ts'
import type { Pace } from '../../lib/pace.ts'

/**
 * The change from one period to the next, over the days both periods have finished.
 *
 * Always a duration, never a percentage: a period with no prior data is a zero baseline,
 * and "+∞%" is not a number to show anyone. The arrow carries the direction.
 *
 * Deliberately colourless. Up was green and down was amber, which asserted that more of
 * everything is better — wrong for sleep, wrong for anything with a ceiling, and exactly
 * backwards for untracked time. The app knows which direction is good in precisely one
 * place, a target, so that is the only place a colour appears.
 *
 * Draws nothing at all when `pace` has no comparison — a period with no closed day in it
 * has nothing to be compared with, and the whole of the day scale is such a period. Saying
 * so on every row would be noise; the old behaviour of comparing anyway is what reported a
 * five-hour collapse at nine in the morning.
 */
export default function Delta({ pace, scale }: { pace: Pace; scale: Period }) {
  if (!pace.comparison) return null

  const { then, now } = pace.comparison
  const change = now - then
  const label = pace.inProgress ? `vs the same point last ${scale}` : `vs previous ${scale}`

  if (change === 0) {
    return <p className="mt-1 text-xs text-ink-muted">No change {label}</p>
  }

  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
      {change > 0 ? (
        <ArrowUp aria-hidden className="size-3 shrink-0" />
      ) : (
        <ArrowDown aria-hidden className="size-3 shrink-0" />
      )}
      <span className="text-ink-soft tabular-nums">{formatDuration(Math.abs(change))}</span>
      {label}
    </p>
  )
}
