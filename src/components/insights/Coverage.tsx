import type { Period } from '../../data/types.ts'
import type { PeriodTotals } from '../../lib/accounting/totals.ts'
import { formatDuration } from '../../lib/format.ts'
import Meter from '../ui/Meter.tsx'
import Delta from './Delta.tsx'

/**
 * Tracked wall-clock and what it left untracked, plus the change against the period
 * before.
 *
 * Tracked is the *union* of every interval, so it cannot exceed the period length even
 * when four timers ran at once — which is what makes untracked meaningful. The
 * denominator is the period clamped to now, so a fully-tracked morning reads 0
 * untracked rather than owing the rest of the day.
 */
export default function Coverage({
  current,
  previous,
  scale,
}: {
  current: PeriodTotals
  previous: PeriodTotals
  scale: Period
}) {
  return (
    <div className="panel mt-4 p-4">
      <p className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">Tracked this {scale}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">
        {formatDuration(current.tracked)}
      </p>
      {/* The coverage the two bare numbers left the reader to work out. Untracked is the
          remainder of this bar, which is why it needs no second card. */}
      <Meter fraction={current.length > 0 ? current.tracked / current.length : 0} />
      <p className="mt-2 text-xs text-ink-muted">
        {formatDuration(current.untracked)} untracked of {formatDuration(current.length)} so far
      </p>
      <Delta from={previous.tracked} to={current.tracked} label={`vs previous ${scale}`} />
    </div>
  )
}
