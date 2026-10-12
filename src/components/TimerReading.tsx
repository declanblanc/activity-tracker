import { formatDuration, formatElapsed } from '../lib/format.ts'
import { useNow } from '../lib/useNow.ts'

/**
 * What a timer says about itself: the session running right now, and the time it has logged
 * today.
 *
 * Two numbers answering the two questions a running timer is asked — "how long have I been at
 * this?" and "how much have I done today?" — and the second one alone when nothing is running.
 * Today's figure *includes* the running session, so the pair invites no arithmetic and pausing
 * does not make it jump.
 *
 * Deliberately says nothing about the **block** — the run from Start to Stop that survives every
 * pause. The block is still what the Stop button ends, but the reading it used to carry paired a
 * total spanning days with the current session's start time, which read as an impossible elapsed
 * ("9:37:52 since 7:43 AM") the morning after a pause.
 *
 * A component for exactly one reason: it owns the once-a-second tick. Hoisting that to the
 * screen would re-render every card on the dashboard every second, most of them check-off cards
 * with nothing on them that moves.
 */
export function TimerReading({
  startedAt,
  todayTotal,
}: {
  /** Present exactly when the activity is running: when the current session began. */
  startedAt?: number
  /**
   * Time logged against this activity today, the running session included.
   *
   * ponytail: this arrives on the screen's slower tick, so while a timer runs it can sit up to
   * 30s behind — invisible at minute resolution, bar the first half-minute of a session, which
   * reads "0m today". Pass the screen's own `now` down and add the difference if that grates.
   */
  todayTotal: number
}) {
  const now = useNow(1000)

  // The session is measured here rather than handed in, so the reading advances on this
  // component's own tick instead of freezing until the screen next refreshes.
  if (startedAt !== undefined) {
    return `${formatElapsed(now - startedAt)} · ${formatDuration(todayTotal)} today`
  }
  return todayTotal > 0 ? `${formatDuration(todayTotal)} today` : 'Not started today'
}

/**
 * A timer card's body: the same two numbers as `TimerReading`, with the one that moves set large.
 *
 * Large because it is the card's whole picture. A habit card's body is its history; a timer's is
 * the clock, and a stopwatch face is what makes the card read as a timer at a glance among the
 * grids. Running, the big number is the session and the caption today's total; at rest there is
 * no session, so today's total takes the big slot.
 *
 * Expanded, it takes the space left under the header and centres in it, since the card stretches
 * to the height of the habit cards in its row. Compact, it is one line, about the height of the
 * week strip a compact habit card carries there.
 *
 * Its own component for the same reason as `TimerReading`: it owns the once-a-second tick.
 */
export function TimerReadout({
  startedAt,
  todayTotal,
  inBlock,
  compact = false,
}: {
  startedAt?: number
  /** Time logged against this activity today, the running session included. */
  todayTotal: number
  /** Whether a block is open, so a paused timer can say it is paused rather than idle. */
  inBlock: boolean
  compact?: boolean
}) {
  const now = useNow(1000)
  const running = startedAt !== undefined

  const [figure, caption] = running
    ? [formatElapsed(now - startedAt), `this session · ${formatDuration(todayTotal)} today`]
    : [formatDuration(todayTotal), inBlock ? 'paused · today' : 'today']

  // Lifted while running, because the card is tinted then and `ink-muted` on a tint is under
  // 4.5:1. The same rule as the shell's own summary line.
  const captionColor = running ? 'text-ink-soft' : 'text-ink-muted'

  if (compact) {
    return (
      <p className="mt-2 flex min-w-0 items-baseline gap-2 tabular-nums">
        <span className="text-base leading-5 font-semibold text-ink">{figure}</span>
        <span className={`truncate text-xs ${captionColor}`}>{caption}</span>
      </p>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center pt-4 pb-2">
      <p className="text-4xl leading-none font-semibold tracking-tight text-ink tabular-nums">
        {figure}
      </p>
      <p className={`mt-2 truncate text-xs ${captionColor}`}>{caption}</p>
    </div>
  )
}
