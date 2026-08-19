import { ArrowDown, ArrowUp } from 'lucide-react'
import { formatDuration } from '../../lib/format.ts'

/**
 * The change from one period to the next.
 *
 * Always a duration, never a percentage: a period with no prior data is a zero baseline,
 * and "+∞%" is not a number to show anyone. The arrow carries the direction.
 *
 * Deliberately colourless. Up was green and down was amber, which asserted that more of
 * everything is better — wrong for sleep, wrong for anything with a ceiling, and exactly
 * backwards for untracked time. The app knows which direction is good in precisely one
 * place, a target, so that is the only place a colour appears.
 */
export default function Delta({ from, to, label }: { from: number; to: number; label: string }) {
  const change = to - from

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
