import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dateKey,
  dayWindow,
  dayWindowsIn,
  formatKey,
  fromDateTimeInput,
  monthWindow,
  parseKey,
  periodWindow,
  shiftKey,
  toDateTimeInput,
  todayKey,
  trailingWindows,
  weekdayOf,
  weekWindow,
} from './time.ts'

// The suite is pinned to America/Los_Angeles by vite.config.ts. Every assertion below
// about DST is only meaningful in a zone that observes it.

const HOUR = 60 * 60 * 1000

/** Local wall-clock time in the suite's pinned zone. */
const local = (iso: string) => new Date(iso).getTime()

afterEach(() => {
  vi.useRealTimers()
})

describe('dayWindow', () => {
  it('spans a whole ordinary local day', () => {
    const { start, end } = dayWindow(local('2026-03-10T14:30:00-07:00'))
    expect(new Date(start).toISOString()).toBe('2026-03-10T07:00:00.000Z')
    expect(end - start).toBe(24 * HOUR)
  })

  it('is 23 hours long on the spring-forward day', () => {
    const { start, end } = dayWindow(local('2026-03-08T12:00:00-08:00'))
    expect(end - start).toBe(23 * HOUR)
  })

  it('is 25 hours long on the fall-back day', () => {
    const { start, end } = dayWindow(local('2026-11-01T12:00:00-07:00'))
    expect(end - start).toBe(25 * HOUR)
  })
})

describe('weekWindow', () => {
  it('starts on the week’s first day at midnight and runs to the next one', () => {
    const { start, end } = weekWindow(local('2026-07-31T09:00:00-07:00'))
    expect(new Date(start).toISOString()).toBe('2026-07-26T07:00:00.000Z')
    expect(end - start).toBe(7 * 24 * HOUR)
  })

  it('starts on a Sunday, which is what the heat grid’s columns assume', () => {
    // Pinned rather than left to the locale: `weekGrid` puts Sunday in row 0, and if
    // scoring moved to Monday a shaded column would report a different week than the
    // goals panel.
    const { start } = weekWindow(local('2026-07-31T09:00:00-07:00'))
    expect(new Date(start).getDay()).toBe(0)
    expect(weekdayOf(dateKey(start))).toBe(0)
  })

  it('is an hour short across the spring-forward week', () => {
    const { start, end } = weekWindow(local('2026-03-10T12:00:00-07:00'))
    expect(end - start).toBe(7 * 24 * HOUR - HOUR)
  })

  it('steps to the neighbouring week from its own bounds', () => {
    const week = weekWindow(local('2026-07-31T09:00:00-07:00'))
    expect(weekWindow(week.end).start).toBe(week.end)
    expect(weekWindow(week.start - 1).end).toBe(week.start)
  })
})

describe('monthWindow', () => {
  it('runs from the first of the month to the first of the next', () => {
    const { start, end } = monthWindow(local('2026-07-31T09:00:00-07:00'))
    expect(new Date(start).toISOString()).toBe('2026-07-01T07:00:00.000Z')
    expect(new Date(end).toISOString()).toBe('2026-08-01T07:00:00.000Z')
    expect(end - start).toBe(31 * 24 * HOUR)
  })

  it('is an hour short across the spring-forward month', () => {
    const { start, end } = monthWindow(local('2026-03-10T12:00:00-07:00'))
    expect(end - start).toBe(31 * 24 * HOUR - HOUR)
  })

  it('follows February’s real length', () => {
    const { start, end } = monthWindow(local('2026-02-14T12:00:00-08:00'))
    expect(end - start).toBe(28 * 24 * HOUR)
  })
})

describe('trailingWindows', () => {
  const at = local('2026-07-31T09:00:00-07:00')

  it('ends with the window containing `at` and runs back from there', () => {
    const days = trailingWindows(at, 'day', 3)
    expect(days).toHaveLength(3)
    expect(days[2]).toEqual(dayWindow(at))
    expect(days.map((day) => new Date(day.start).getDate())).toEqual([29, 30, 31])
  })

  it('leaves no gap or overlap between neighbouring windows', () => {
    for (const period of ['day', 'week', 'month'] as const) {
      const windows = trailingWindows(at, period, 5)
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i].start).toBe(windows[i - 1].end)
      }
    }
  })

  it('keeps every window a real local period across a DST transition', () => {
    const days = trailingWindows(local('2026-03-10T12:00:00-07:00'), 'day', 4)
    expect(days.map((day) => day.end - day.start)).toEqual([
      24 * HOUR,
      23 * HOUR, // spring forward
      24 * HOUR,
      24 * HOUR,
    ])
  })

  it('dispatches to the window of the named period', () => {
    expect(periodWindow(at, 'day')).toEqual(dayWindow(at))
    expect(periodWindow(at, 'week')).toEqual(weekWindow(at))
    expect(periodWindow(at, 'month')).toEqual(monthWindow(at))
  })
})

describe('dayWindowsIn', () => {
  it('covers every day a browsed range touches, oldest first', () => {
    const days = dayWindowsIn(weekWindow(local('2026-07-31T09:00:00-07:00')))
    expect(days).toHaveLength(7)
    expect(days.map((day) => new Date(day.start).getDate())).toEqual([26, 27, 28, 29, 30, 31, 1])
  })

  it('leaves no gap between neighbouring days', () => {
    const days = dayWindowsIn(monthWindow(local('2026-03-10T12:00:00-07:00')))
    for (let i = 1; i < days.length; i++) expect(days[i].start).toBe(days[i - 1].end)
  })

  it('steps a DST week as seven real days, not 168 fixed hours', () => {
    // Stepping by a constant 24h would either skip Mar 8 or emit it twice. Mar 8 is the
    // second Sunday in March, so the transition day is also the day the week starts on.
    const days = dayWindowsIn(weekWindow(local('2026-03-10T12:00:00-07:00')))
    expect(days).toHaveLength(7)
    expect(days.map((day) => day.end - day.start)).toEqual([
      23 * HOUR, // Mar 8, spring forward
      24 * HOUR,
      24 * HOUR,
      24 * HOUR,
      24 * HOUR,
      24 * HOUR,
      24 * HOUR,
    ])
  })

  it('returns the one day a sub-day range sits inside', () => {
    const at = local('2026-07-31T09:00:00-07:00')
    expect(dayWindowsIn({ start: at, end: at + HOUR })).toEqual([dayWindow(at)])
  })
})

describe('dateKey', () => {
  it('zero-pads month and day', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('names the local day, not the UTC one', () => {
    // 23:00 on Aug 3 in Los Angeles is already Aug 4 in UTC. `toISOString().slice(0, 10)`
    // would report Aug 4 and fill in tomorrow's square.
    const at = local('2026-08-04T06:00:00Z')
    expect(dateKey(at)).toBe('2026-08-03')
    expect(new Date(at).toISOString().slice(0, 10)).toBe('2026-08-04')
  })
})

describe('todayKey', () => {
  it('uses the local date late in the evening', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T06:00:00Z'))
    expect(todayKey()).toBe('2026-08-03')
  })
})

describe('parseKey', () => {
  it('returns local midnight', () => {
    const parsed = parseKey('2026-08-03')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(7)
    expect(parsed.getDate()).toBe(3)
    expect(parsed.getHours()).toBe(0)
    expect(parsed.getMinutes()).toBe(0)
  })

  it('does not take the time of day from the moment it is called', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T17:34:21Z'))
    expect(parseKey('2026-08-03').getHours()).toBe(0)
  })

  it('round-trips through dateKey', () => {
    expect(dateKey(parseKey('2026-11-01'))).toBe('2026-11-01')
  })

  it('agrees with dayWindow about where a day starts', () => {
    expect(parseKey('2026-11-01').getTime()).toBe(dayWindow(local('2026-11-01T12:00:00-07:00')).start)
  })
})

describe('shiftKey across DST', () => {
  // Both of these are wrong if days are stepped by adding 86_400_000 milliseconds.
  it('does not repeat a day when the clocks fall back', () => {
    // Nov 1 2026 gains an hour, so local midnight + 24h is still Nov 1 (23:00).
    expect(shiftKey('2026-11-01', 1)).toBe('2026-11-02')
  })

  it('does not skip a day when the clocks spring forward', () => {
    // Mar 8 2026 loses an hour, so local midnight - 24h lands on Mar 7 (23:00).
    expect(shiftKey('2026-03-09', -1)).toBe('2026-03-08')
  })

  it('steps a full week over a transition', () => {
    expect(shiftKey('2026-03-05', 7)).toBe('2026-03-12')
    expect(shiftKey('2026-10-29', 7)).toBe('2026-11-05')
  })

  it('crosses month and year boundaries', () => {
    expect(shiftKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftKey('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('weekdayOf', () => {
  it('reports Sunday as 0', () => {
    expect(weekdayOf('2026-08-02')).toBe(0) // a Sunday
    expect(weekdayOf('2026-08-03')).toBe(1) // the Monday after
  })
})

describe('formatKey', () => {
  it('renders the local calendar day', () => {
    expect(formatKey('2026-08-03')).toContain('Aug')
    expect(formatKey('2026-08-03')).toContain('3')
  })
})

describe('datetime-local conversion', () => {
  it('round-trips a local wall-clock minute', () => {
    const at = local('2026-07-31T09:45:00-07:00')
    expect(toDateTimeInput(at)).toBe('2026-07-31T09:45')
    expect(fromDateTimeInput(toDateTimeInput(at))).toBe(at)
  })

  it('reads an incomplete value as NaN rather than as some other time', () => {
    expect(fromDateTimeInput('')).toBeNaN()
    expect(fromDateTimeInput('2026-07-31T')).toBeNaN()
  })
})
