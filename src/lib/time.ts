import {
  addDays,
  addMonths,
  addWeeks,
  format,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import type { DateKey, Period } from '../data/types.ts'

/**
 * All calendar math, in the two representations the app needs.
 *
 * A `TimeWindow` *measures* a period, in epoch milliseconds, so `lib/accounting/` can be a
 * pure function over numbers with no calendar in it. A `DateKey` *names* a day, so the heat
 * grid can lay one out and a completion can be stored against it. `lib/days.ts` is the one
 * module that converts between them.
 *
 * Nothing here does `Date` arithmetic by hand, and nothing anywhere else does calendar
 * arithmetic at all.
 */

/**
 * A half-open interval `[start, end)` in UTC epoch milliseconds.
 *
 * Every boundary in this module is computed in the device's local time and then flattened
 * to epoch ms, so `lib/accounting/` never has to know about calendars.
 */
export type TimeWindow = {
  start: number
  end: number
}

/**
 * Sunday.
 *
 * Shared by `weekWindow` and `weekGrid` so the two cannot drift apart. date-fns's
 * `startOfWeek` defaults to the locale's first weekday, which is Sunday only because the
 * default locale is en-US — configure a locale and week *scoring* would move to Monday
 * while the grid's columns stayed on Sunday, so a shaded column would report a different
 * week than the goals panel did. Pinning it makes the agreement a fact rather than a
 * coincidence, and matches the GitHub contribution graph the grid is modelled on.
 */
export const WEEK_STARTS_ON = 0

/**
 * The local calendar day containing `at`.
 *
 * The end is the *next* day's start rather than `start + 24h`: on the two DST transition
 * days the local day is genuinely 23 or 25 hours long, and untracked time is computed
 * against this length.
 */
export function dayWindow(at: number): TimeWindow {
  const dayStart = startOfDay(at)
  return {
    start: dayStart.getTime(),
    end: addDays(dayStart, 1).getTime(),
  }
}

/**
 * The local calendar week containing `at`, starting on `WEEK_STARTS_ON`.
 *
 * Like `dayWindow`, the end is the next week's start rather than `start + 7 days`, so the
 * week that contains a DST transition is 167 or 169 hours long, which is what untracked time is
 * measured against.
 */
export function weekWindow(at: number): TimeWindow {
  const weekStart = startOfWeek(at, { weekStartsOn: WEEK_STARTS_ON })
  return {
    start: weekStart.getTime(),
    end: addWeeks(weekStart, 1).getTime(),
  }
}

/**
 * The local calendar month containing `at`.
 *
 * The end is the next month's start, never `start + 30 days` — months are 28 to 31 days
 * long, and one of them also contains a DST transition.
 */
export function monthWindow(at: number): TimeWindow {
  const monthStart = startOfMonth(at)
  return {
    start: monthStart.getTime(),
    end: addMonths(monthStart, 1).getTime(),
  }
}

const WINDOW: Record<Period, (at: number) => TimeWindow> = {
  day: dayWindow,
  week: weekWindow,
  month: monthWindow,
}

/** The local period of `period` size containing `at`. */
export function periodWindow(at: number, period: Period): TimeWindow {
  return WINDOW[period](at)
}

/**
 * `count` consecutive windows ending with the one containing `at`, oldest first.
 *
 * This is one of only two places period arithmetic happens, so `lib/accounting/` can stay a
 * pure function over numbers: it is handed the windows rather than a bucket size it would
 * need a calendar to interpret. Stepping back through `start - 1` rather than subtracting a
 * fixed length keeps every window a real local period across DST.
 */
export function trailingWindows(at: number, period: Period, count: number): TimeWindow[] {
  const windows = [periodWindow(at, period)]
  while (windows.length < count) {
    windows.unshift(periodWindow(windows[0].start - 1, period))
  }
  return windows
}

/**
 * Every local calendar day that intersects `range`, oldest first.
 *
 * `trailingWindows` covers "the last N periods"; this covers an arbitrary browsed range,
 * which is what a screen stepping back through history needs. Stepped by
 * `dayWindow(previous.end)` and never by a fixed 24 hours, so the two DST days are the 23
 * and 25 hours they really are and none is skipped or repeated.
 */
export function dayWindowsIn(range: TimeWindow): TimeWindow[] {
  const days = [dayWindow(range.start)]
  while (days[days.length - 1].end < range.end) {
    days.push(dayWindow(days[days.length - 1].end))
  }
  return days
}

/**
 * A day named by its local calendar parts, never by `toISOString()`. `toISOString` is UTC:
 * logging something at 6pm Tuesday in California would fill in Wednesday's square.
 *
 * date-fns's `format` reads local parts, which is what makes it the right tool here and
 * `toISOString` the wrong one.
 */
export function dateKey(date: Date | number): DateKey {
  return format(date, 'yyyy-MM-dd')
}

export function todayKey(): DateKey {
  return dateKey(new Date())
}

/**
 * Local midnight on `key`. `new Date('2026-08-03')` would parse as UTC and can land a day
 * off, west of Greenwich.
 *
 * `parse` fills units the format string does not mention from its reference date, so the
 * time of day would otherwise be whatever time it is now; `startOfDay` strips it, which is
 * what keeps this deterministic despite the `new Date()`.
 */
export function parseKey(key: DateKey): Date {
  return startOfDay(parse(key, 'yyyy-MM-dd', new Date()))
}

/**
 * `key` moved by whole calendar days.
 *
 * date-fns's `addDays` steps the date field, which the platform adjusts for DST. Adding
 * `days * 86_400_000` instead would skip or repeat a day at each transition, silently
 * corrupting every streak twice a year.
 */
export function shiftKey(key: DateKey, days: number): DateKey {
  return dateKey(addDays(parseKey(key), days))
}

/** The weekday of `key`, Sunday 0 — the row a day belongs in on the heat grid. */
export function weekdayOf(key: DateKey): number {
  return parseKey(key).getDay()
}

/** `key` for a human, in the reader's locale. */
export function formatKey(key: DateKey): string {
  return parseKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * `at` as the local wall-clock string an `<input type="datetime-local">` expects.
 *
 * The native input is the whole date-and-time picker, so this pair of conversions is all
 * the app needs to let one be edited.
 */
export function toDateTimeInput(at: number): string {
  return format(at, "yyyy-MM-dd'T'HH:mm")
}

/**
 * The inverse. A half-typed or cleared input yields `NaN`, which every comparison a caller
 * makes against it is false for — so an incomplete value can never pass a range check by
 * accident.
 */
export function fromDateTimeInput(value: string): number {
  return new Date(value).getTime()
}
