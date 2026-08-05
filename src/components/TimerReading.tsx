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
