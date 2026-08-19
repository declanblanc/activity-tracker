import type { Measure, Period } from '../data/types.ts'
import type { TimeWindow } from './time.ts'

const MINUTE = 60 * 1000

/**
 * A running timer as `2:05:09` (or `5:09` under an hour). Seconds are shown so that
 * the once-a-second tick is visible — a timer reading `0h 0m` for a minute looks
 * broken.
 */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60].map((part) =>
    String(part).padStart(2, '0'),
  )
  const hours = Math.floor(seconds / 3600)
  return hours > 0 ? `${hours}:${parts.join(':')}` : parts.join(':')
}

/**
 * A settled duration as `2h 5m`, where seconds would be noise.
 *
 * A whole number of hours drops the minutes entirely: goals are usually set at round hours, and
 * "Goal: 4h 0m a day" is not how anyone says it.
 */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE))
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${minutes}m`
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
}

/**
 * An amount in whatever unit its measure counts in: a duration as `2h 5m`, a count as a
 * number of days.
 *
 * This is the one function that has to know which measure it is looking at, and it exists
 * because `lib/days.ts` deliberately erases that distinction — every number reaching a screen
 * is a bare amount, and only the last step before it is rendered can put a unit on it.
 *
 * `bare` drops the unit for a number that already sits beside its own label, as in
 * "3 of 5 this week", where "3 days of 5 days this week" reads badly.
 */
export function formatAmount(measure: Measure, amount: number, bare = false): string {
  if (measure === 'duration') return formatDuration(amount)
  const days = Math.max(0, Math.round(amount))
  if (bare) return String(days)
  return days === 1 ? '1 day' : `${days} days`
}

/**
 * A wall-clock time as the device's locale writes it, e.g. `14:05` or `6:45 PM`.
 *
 * `hour: 'numeric'` rather than `'2-digit'`: a 12-hour locale wrote `06:45 PM`, which is
 * both a leading zero nobody says out loud and eight characters where six would do — and
 * these appear inside single lines that have to fit a 375px row.
 */
export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** What the period containing `now` is called, so a stepper at the present says so. */
export function thisPeriod(scale: Period): string {
  return { day: 'Today', week: 'This week', month: 'This month' }[scale]
}

/** `Fri, Jul 31`, `Jul 26 – Aug 1`, or `July 2026`. */
export function periodLabel(window: TimeWindow, scale: Period): string {
  const date = (at: number, options: Intl.DateTimeFormatOptions) =>
    new Date(at).toLocaleDateString([], options)

  if (scale === 'month') return date(window.start, { month: 'long', year: 'numeric' })
  if (scale === 'day') return date(window.start, { weekday: 'short', month: 'short', day: 'numeric' })

  const day = { month: 'short', day: 'numeric' } as const
  // The window end is exclusive, so the label names the last day inside it.
  return `${date(window.start, day)} – ${date(window.end - 1, day)}`
}

/**
 * The short form that fits under a bar. A bare day number is ambiguous once the run of
 * weeks crosses a month, so a week is labelled by the month too; the axis drops whatever
 * does not fit and the tooltip carries the full range either way.
 */
export function tickLabel(window: TimeWindow, scale: Period): string {
  const options: Intl.DateTimeFormatOptions =
    scale === 'month'
      ? { month: 'short' }
      : scale === 'week'
        ? { month: 'short', day: 'numeric' }
        : { day: 'numeric' }
  return new Date(window.start).toLocaleDateString([], options)
}
