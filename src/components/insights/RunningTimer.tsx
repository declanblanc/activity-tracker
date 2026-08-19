import { formatElapsed } from '../../lib/format.ts'
import { useNow } from '../../lib/useNow.ts'

/**
 * The running stretch, counting up.
 *
 * It keeps its own clock rather than reading the screen's `now`, which ticks every 30
 * seconds: every number on this screen costs a pass over up to a year of entries, and a
 * timer that only moved twice a minute would look stuck. Re-rendering one span each
 * second is free; re-running the accounting each second is not.
 *
 * The count alone, with no "since 6:45 PM" after it. This sits in a card about a third of
 * a phone's width, where the start time wrapped onto a second line — and a bare clock
 * time is a lie about the stretch that has been open since Friday, which is exactly the
 * one worth noticing. The sheet's own list and Today both name the start.
 */
export default function RunningTimer({ startedAt }: { startedAt: number }) {
  const now = useNow()

  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
      <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
      Running <span className="tabular-nums">{formatElapsed(now - startedAt)}</span>
    </p>
  )
}
