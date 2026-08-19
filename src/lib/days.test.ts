import { describe, expect, it } from 'vitest'
import {
  NOT_DELETED,
  OPEN_ENTRY_END,
  completionId,
  type Activity,
  type Completion,
  type Entry,
} from '../data/types.ts'
import { bucketTotals } from './accounting/totals.ts'
import { dayAmounts, periodAmounts } from './days.ts'
import { dateKey, dayWindowsIn, dayWindow, monthWindow, trailingWindows, weekWindow } from './time.ts'

// Pinned to America/Los_Angeles by vite.config.ts.

const HOUR = 60 * 60 * 1000
const local = (iso: string) => new Date(iso).getTime()

function activity(fields: Partial<Activity>): Activity {
  return {
    id: 'a',
    name: 'Reading',
    color: '#38bdf8',
    measure: 'duration',
    archived: false,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: NOT_DELETED,
    ...fields,
  }
}

function entry(startedAt: number, endedAt: number, activityId = 'a'): Entry {
  return {
    id: `${activityId}-${startedAt}`,
    activityId,
    startedAt,
    endedAt,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: NOT_DELETED,
  }
}

function completion(day: string, done = true, activityId = 'a'): Completion {
  return { id: completionId(activityId, day), activityId, day, done, updatedAt: 0 }
}

describe('dayAmounts for a count activity', () => {
  const counted = activity({ measure: 'count' })
  const now = local('2026-08-03T23:00:00-07:00')
  const days = trailingWindows(local('2026-08-03T09:00:00-07:00'), 'day', 7)

  it('gives a logged day an amount of 1', () => {
    const amounts = dayAmounts(counted, [], [completion('2026-08-03')], days, Date.now())
    expect(amounts.get('2026-08-03')).toBe(1)
  })

  it('gives a cleared day nothing, so it reads as a miss', () => {
    // `done: false` is a recorded decision, not an absence — but for scoring it is a zero,
    // exactly as a day with no row at all is.
    const amounts = dayAmounts(counted, [], [completion('2026-08-03', false)], days, Date.now())
    expect(amounts.get('2026-08-03')).toBeUndefined()
  })

  it('ignores another activity’s check-offs', () => {
    const amounts = dayAmounts(
      counted,
      [],
      [completion('2026-08-03', true, 'other')],
      days,
      Date.now(),
    )
    expect(amounts.size).toBe(0)
  })

  it('checks a day off because the timer ran on it', () => {
    // The two axes are one habit: a day you tracked is a day you did the thing, and it fills
    // its square and feeds the streak without also asking for a tap.
    const at = local('2026-08-03T10:00:00-07:00')
    const amounts = dayAmounts(counted, [entry(at, at + HOUR)], [], days, now)
    expect(amounts.get('2026-08-03')).toBe(1)
  })

  it('counts a tracked day once, however many stretches it holds', () => {
    const morning = local('2026-08-03T09:00:00-07:00')
    const evening = local('2026-08-03T20:00:00-07:00')
    const amounts = dayAmounts(
      counted,
      [entry(morning, morning + HOUR), entry(evening, evening + HOUR)],
      [],
      days,
      now,
    )
    expect(amounts.get('2026-08-03')).toBe(1)
  })

  it('keeps a tracked day checked off, whatever the stored row says', () => {
    // The interval is the record that the day happened, so `done: false` cannot take it back —
    // deleting the time is what clears the day, and the dashboard says so on the tap.
    const at = local('2026-08-03T10:00:00-07:00')
    const cleared = [completion('2026-08-03', false)]
    const amounts = dayAmounts(counted, [entry(at, at + HOUR)], cleared, days, now)
    expect(amounts.get('2026-08-03')).toBe(1)
  })

  it('leaves a cleared day cleared when no time was tracked on it', () => {
    // `done: false` is still the un-log gesture; it is only tracked time it cannot outrank.
    const amounts = dayAmounts(counted, [], [completion('2026-08-03', false)], days, now)
    expect(amounts.get('2026-08-03')).toBeUndefined()
  })

  it('ignores another activity’s tracked time', () => {
    const at = local('2026-08-03T10:00:00-07:00')
    const amounts = dayAmounts(counted, [entry(at, at + HOUR, 'other')], [], days, now)
    expect(amounts.size).toBe(0)
  })

  it('credits tracked time only inside the days it was handed', () => {
    // Completions arrive whole, so they are all-time; time is bounded by whatever range the
    // screen read. A day outside it is not credited — the bound `dayAmounts` documents.
    const old = local('2019-01-01T10:00:00-08:00')
    const amounts = dayAmounts(counted, [entry(old, old + HOUR)], [], days, now)
    expect(amounts.get('2019-01-01')).toBeUndefined()
  })

  it('is not bounded by the days handed in, so a streak can run all-time', () => {
    const amounts = dayAmounts(counted, [], [completion('2019-01-01')], days, Date.now())
    expect(amounts.get('2019-01-01')).toBe(1)
  })
})

describe('dayAmounts for a duration activity', () => {
  const timed = activity({})
  const now = local('2026-08-03T18:00:00-07:00')
  const days = trailingWindows(now, 'day', 7)

  it('sums the milliseconds tracked within each local day', () => {
    const entries = [
      entry(local('2026-08-03T09:00:00-07:00'), local('2026-08-03T11:00:00-07:00')),
      entry(local('2026-08-03T14:00:00-07:00'), local('2026-08-03T14:30:00-07:00')),
    ]
    expect(dayAmounts(timed, entries, [], days, now).get('2026-08-03')).toBe(2.5 * HOUR)
  })

  it('splits an entry that spans midnight across two keys that sum to its length', () => {
    // The 23:00→07:00 sleep entry: the case that makes an `endedAt`-anchored read necessary
    // and a naive "entries that started today" read wrong.
    const entries = [
      entry(local('2026-08-02T23:00:00-07:00'), local('2026-08-03T07:00:00-07:00')),
    ]
    const amounts = dayAmounts(timed, entries, [], days, now)
    expect(amounts.get('2026-08-02')).toBe(1 * HOUR)
    expect(amounts.get('2026-08-03')).toBe(7 * HOUR)
    expect(amounts.get('2026-08-02')! + amounts.get('2026-08-03')!).toBe(8 * HOUR)
  })

  it('counts an open entry only up to now', () => {
    const entries = [entry(local('2026-08-03T16:00:00-07:00'), OPEN_ENTRY_END)]
    expect(dayAmounts(timed, entries, [], days, now).get('2026-08-03')).toBe(2 * HOUR)
  })

  it('ignores another activity’s entries', () => {
    const entries = [
      entry(local('2026-08-03T09:00:00-07:00'), local('2026-08-03T11:00:00-07:00'), 'other'),
    ]
    expect(dayAmounts(timed, entries, [], days, now).get('2026-08-03') ?? 0).toBe(0)
  })

  it('ignores check-offs, which a timed activity should never have', () => {
    expect(dayAmounts(timed, [], [completion('2026-08-03')], days, now).get('2026-08-03')).toBe(0)
  })

  it('names each day by its local parts, not by UTC', () => {
    // 18:00 in Los Angeles is already tomorrow in UTC. Keying off `toISOString()` would
    // file the evening under the wrong square.
    const entries = [entry(local('2026-08-03T18:30:00-07:00'), local('2026-08-03T19:00:00-07:00'))]
    const later = local('2026-08-03T20:00:00-07:00')
    const amounts = dayAmounts(timed, entries, [], trailingWindows(later, 'day', 3), later)
    expect(amounts.get('2026-08-03')).toBe(0.5 * HOUR)
    expect(amounts.get('2026-08-04')).toBeUndefined()
  })
})

describe('dayAmounts across DST', () => {
  const timed = activity({})

  it('files a spring-forward day, which is only 23 hours long, on the right key', () => {
    const now = local('2026-03-08T20:00:00-07:00')
    const days = dayWindowsIn({ start: local('2026-03-07T00:00:00-08:00'), end: now })
    // 01:00–03:00 local on Mar 8 is one real hour: 02:00 never happens.
    const entries = [entry(local('2026-03-08T01:00:00-08:00'), local('2026-03-08T03:00:00-07:00'))]
    const amounts = dayAmounts(timed, entries, [], days, now)

    expect(amounts.get('2026-03-08')).toBe(1 * HOUR)
    expect(amounts.get('2026-03-07') ?? 0).toBe(0)
  })

  it('files a fall-back day, which is 25 hours long, on the right key', () => {
    const now = local('2026-11-01T20:00:00-08:00')
    const days = dayWindowsIn({ start: local('2026-10-31T00:00:00-07:00'), end: now })
    // 01:00 to 02:00 local on Nov 1 is *two* real hours, because 01:00 happens twice. Real
    // elapsed time is what gets measured, not the difference the wall clock appears to show.
    const entries = [entry(local('2026-11-01T01:00:00-07:00'), local('2026-11-01T02:00:00-08:00'))]
    const amounts = dayAmounts(timed, entries, [], days, now)

    expect(amounts.get('2026-11-01')).toBe(2 * HOUR)
    expect(amounts.get('2026-10-31') ?? 0).toBe(0)
  })

  it('emits one key per real local day over a transition, with none repeated', () => {
    const now = local('2026-11-03T12:00:00-08:00')
    const days = dayWindowsIn({ start: local('2026-10-30T00:00:00-07:00'), end: now })
    const amounts = dayAmounts(activity({ measure: 'count' }), [], [], days, now)
    // The count branch returns no keys, so assert on the windows the duration branch reads.
    expect(amounts.size).toBe(0)
    expect(days.map((day) => dateKey(day.start))).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ])
  })
})

describe('periodAmounts', () => {
  const now = local('2026-08-03T18:00:00-07:00')

  it('sums a week from its seven days', () => {
    const amounts = new Map([
      ['2026-08-02', 1],
      ['2026-08-03', 1],
      ['2026-08-05', 1],
      // Outside the week containing Aug 3 (which runs Sun Aug 2 – Sat Aug 8).
      ['2026-08-01', 1],
    ])
    expect(periodAmounts(amounts, [weekWindow(now)])[0].total).toBe(3)
  })

  it('keeps the nominal window so a caller can tell the period is still open', () => {
    const week = weekWindow(now)
    expect(periodAmounts(new Map(), [week])[0].window).toEqual(week)
  })

  it('counts a day exactly once, at the period it belongs to', () => {
    const amounts = new Map([['2026-08-03', 5]])
    const weeks = trailingWindows(now, 'week', 4)
    expect(periodAmounts(amounts, weeks).map((period) => period.total)).toEqual([0, 0, 0, 5])
  })

  it('sums a month without spilling into the next', () => {
    const amounts = new Map([
      ['2026-07-31', 1],
      ['2026-08-01', 1],
      ['2026-08-31', 1],
      ['2026-09-01', 1],
    ])
    expect(periodAmounts(amounts, [monthWindow(now)])[0].total).toBe(2)
  })

  it('sums exactly seven days across a spring-forward week', () => {
    // The week is 167 hours long, but it is still seven calendar days, and stepping by
    // `shiftKey` visits each of them once.
    const dstNow = local('2026-03-10T12:00:00-07:00')
    const week = weekWindow(dstNow)
    const amounts = new Map(
      dayWindowsIn(week).map((day) => [dateKey(day.start), 1] as [string, number]),
    )
    expect(amounts.size).toBe(7)
    expect(periodAmounts(amounts, [week])[0].total).toBe(7)
  })

  it('sums exactly seven days across a fall-back week', () => {
    const dstNow = local('2026-11-03T12:00:00-08:00')
    const week = weekWindow(dstNow)
    const amounts = new Map(
      dayWindowsIn(week).map((day) => [dateKey(day.start), 1] as [string, number]),
    )
    expect(amounts.size).toBe(7)
    expect(periodAmounts(amounts, [week])[0].total).toBe(7)
  })

  it('agrees with bucketTotals over the same week — the equivalence this rests on', () => {
    // Summing per-day amounts into a week must give what accounting gives for the week
    // directly. If these ever diverge, a heat column and its goal disagree.
    const timed = activity({})
    const entries = [
      entry(local('2026-08-02T23:00:00-07:00'), local('2026-08-03T07:00:00-07:00')),
      entry(local('2026-08-05T09:00:00-07:00'), local('2026-08-05T11:30:00-07:00')),
      entry(local('2026-08-03T16:00:00-07:00'), OPEN_ENTRY_END),
    ]
    const week = weekWindow(now)
    const amounts = dayAmounts(timed, entries, [], dayWindowsIn(week), now)

    const summedFromDays = periodAmounts(amounts, [week])[0].total
    const straightFromAccounting = bucketTotals(entries, [week], now)[0].perActivity.get('a')

    expect(summedFromDays).toBe(straightFromAccounting)
  })

  it('agrees with bucketTotals across a DST week', () => {
    const timed = activity({})
    const dstNow = local('2026-03-10T12:00:00-07:00')
    const entries = [
      entry(local('2026-03-08T01:00:00-08:00'), local('2026-03-08T03:00:00-07:00')),
      entry(local('2026-03-09T22:00:00-07:00'), local('2026-03-10T02:00:00-07:00')),
    ]
    const week = weekWindow(dstNow)
    const amounts = dayAmounts(timed, entries, [], dayWindowsIn(week), dstNow)

    expect(periodAmounts(amounts, [week])[0].total).toBe(
      bucketTotals(entries, [week], dstNow)[0].perActivity.get('a'),
    )
  })

  it('reads an uncovered day as zero, which is why callers derive both lists from one range', () => {
    // Documented hazard rather than desired behaviour: a streak would break at the edge of
    // the horizon if a caller passed windows the amounts do not cover.
    const amounts = new Map([['2026-08-03', 1]])
    const yesterday = dayWindow(local('2026-08-02T12:00:00-07:00'))
    expect(periodAmounts(amounts, [yesterday])[0].total).toBe(0)
  })
})
