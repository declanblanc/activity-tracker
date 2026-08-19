import { ChevronRight } from 'lucide-react'
import type { Period } from '../../data/types.ts'
import type { PeriodTotals } from '../../lib/accounting/totals.ts'
import { formatDuration } from '../../lib/format.ts'
import type { Pace } from '../../lib/pace.ts'
import Meter from '../ui/Meter.tsx'
import Delta from './Delta.tsx'

/**
 * Tracked wall-clock and what it left untracked.
 *
 * Tracked is the *union* of every interval, so it cannot exceed the period length even
 * when four timers ran at once — which is what makes untracked meaningful. The
 * denominator is the period clamped to now, so a fully-tracked morning reads 0
 * untracked rather than owing the rest of the day.
 *
 * **Collapsed, and no longer the headline.** This was the largest type on the screen, which
 * framed the whole of Insights as a timesheet you are expected to fill: "51h 49m untracked"
 * is not a finding, it is the rest of a life. The accounting is right and worth keeping —
 * a summary line says the number, and opening it gives the rest.
 */
export default function Coverage({
  current,
  scale,
  pace,
}: {
  current: PeriodTotals
  scale: Period
  /** The tracked union's own pace, so its delta compares like with like. */
  pace: Pace
}) {
  return (
    <details className="panel group mt-4 p-4">
      <summary className="focus-ring flex cursor-pointer list-none items-baseline gap-2 rounded-sm">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 translate-y-0.5 text-ink-muted transition-transform group-open:rotate-90"
        />
        <span className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">
          Coverage
        </span>
        <span className="ml-auto text-xs text-ink-soft tabular-nums">
          {formatDuration(current.tracked)} of {formatDuration(current.length)}
        </span>
      </summary>

      <div className="mt-3">
        <Meter fraction={current.length > 0 ? current.tracked / current.length : 0} />
        <p className="mt-2 text-xs text-ink-muted">
          {formatDuration(current.untracked)} of this {scale} has no timer against it. Overlapping
          timers count once here, which is what makes the remainder mean anything.
        </p>
        <Delta pace={pace} scale={scale} />
      </div>
    </details>
  )
}
