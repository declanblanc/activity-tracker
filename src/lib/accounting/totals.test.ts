import { describe, expect, it } from 'vitest'
import { NOT_DELETED, OPEN_ENTRY_END, type Entry } from '../../data/types.ts'
import { dayWindow, trailingWindows, weekWindow } from '../time.ts'
import {
  bucketTotals,
  perActivityTotals,
  periodTotals,
  totalSince,
  trackedWallClock,
  untracked,
} from './totals.ts'

const HOUR = 60 * 60 * 1000

/** Local wall-clock time in the suite's pinned zone (America/Los_Angeles). */
const local = (iso: string) => new Date(iso).getTime()

/** Only the four fields the accounting layer reads are worth spelling out. */
function entry(activityId: string, startedAt: number, endedAt: number): Entry {
  return {
    id: `${activityId}-${startedAt}`,
    activityId,
    startedAt,
    endedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: NOT_DELETED,
  }
}

describe('perActivityTotals', () => {
  it('sums one activity’s intervals inside the window', () => {
    const day = dayWindow(local('2026-07-30T12:00:00-07:00'))
    const entries = [
      entry('work', local('2026-07-30T09:00:00-07:00'), local('2026-07-30T11:00:00-07:00')),
      entry('work', local('2026-07-30T13:00:00-07:00'), local('2026-07-30T13:30:00-07:00')),
    ]

    expect(perActivityTotals(entries, day, local('2026-07-31T00:00:00-07:00'))).toEqual(
      new Map([['work', 2.5 * HOUR]]),
    )
  })

  it('counts only the portion of a midnight-crossing interval inside each day', () => {
    // 23:00 Wednesday → 07:00 Thursday, a single stored record.
    const sleep = entry(
      'sleep',
      local('2026-07-29T23:00:00-07:00'),
      local('2026-07-30T07:00:00-07:00'),
    )
    const now = local('2026-08-01T00:00:00-07:00')

    const wednesday = perActivityTotals([sleep], dayWindow(sleep.startedAt), now)
    const thursday = perActivityTotals([sleep], dayWindow(sleep.endedAt), now)

    expect(wednesday.get('sleep')).toBe(HOUR)
    expect(thursday.get('sleep')).toBe(7 * HOUR)
  })

  it('finds an entry that started before the window and ended inside it', () => {
    const sleep = entry(
      'sleep',
      local('2026-07-29T23:00:00-07:00'),
      local('2026-07-30T07:00:00-07:00'),
    )
    const thursday = dayWindow(local('2026-07-30T12:00:00-07:00'))

    // The entry starts outside the window entirely: an implementation anchored on
    // `startedAt` would report nothing at all here.
    expect(sleep.startedAt).toBeLessThan(thursday.start)
    expect(perActivityTotals([sleep], thursday, local('2026-08-01T00:00:00-07:00'))).toEqual(
      new Map([['sleep', 7 * HOUR]]),
    )
  })

  it('counts an open entry up to now, not to the end of the window', () => {
    const open = entry('work', local('2026-07-31T09:00:00-07:00'), OPEN_ENTRY_END)
    const day = dayWindow(open.startedAt)

    expect(perActivityTotals([open], day, local('2026-07-31T11:30:00-07:00'))).toEqual(
      new Map([['work', 2.5 * HOUR]]),
    )
  })

  it('clamps an open entry that is still running past the end of the window', () => {
    const open = entry('work', local('2026-07-30T22:00:00-07:00'), OPEN_ENTRY_END)
    const wednesday = dayWindow(open.startedAt)

    // Still running the next afternoon: the day gets its last two hours, no more.
    expect(perActivityTotals([open], wednesday, local('2026-07-31T14:00:00-07:00'))).toEqual(
      new Map([['work', 2 * HOUR]]),
    )
  })

  it('ignores an entry that does not touch the window', () => {
    const yesterday = entry(
      'work',
      local('2026-07-29T09:00:00-07:00'),
      local('2026-07-29T17:00:00-07:00'),
    )
    const today = dayWindow(local('2026-07-31T12:00:00-07:00'))

    expect(perActivityTotals([yesterday], today, local('2026-07-31T23:00:00-07:00'))).toEqual(
      new Map(),
    )
  })

  it('lets overlapping activities each count the shared time in full', () => {
    const day = dayWindow(local('2026-07-30T12:00:00-07:00'))
    const entries = [
      entry('work', local('2026-07-30T09:00:00-07:00'), local('2026-07-30T12:00:00-07:00')),
      entry('deep', local('2026-07-30T10:00:00-07:00'), local('2026-07-30T12:00:00-07:00')),
    ]
    const now = local('2026-07-31T00:00:00-07:00')

    expect(perActivityTotals(entries, day, now)).toEqual(
      new Map([
        ['work', 3 * HOUR],
        ['deep', 2 * HOUR],
      ]),
    )
    // Five activity-hours over three hours of wall-clock, and both numbers are right.
    expect(trackedWallClock(entries, day, now)).toBe(3 * HOUR)
  })
})

describe('totalSince', () => {
  const blockStart = local('2026-07-30T09:00:00-07:00')

  it('adds up the stretches of a block and ignores the pauses between them', () => {
    const now = local('2026-07-30T17:00:00-07:00')
    const entries = [
      entry('work', blockStart, local('2026-07-30T12:00:00-07:00')),
      entry('work', local('2026-07-30T13:00:00-07:00'), now),
    ]

    // Eight hours between the ends of the block, seven of them tracked: the hour paused
    // for lunch is not in the total.
    expect(totalSince(entries, 'work', blockStart, now)).toBe(7 * HOUR)
  })

  it('counts a running stretch up to now', () => {
    const now = local('2026-07-30T13:30:00-07:00')
    const entries = [
      entry('work', blockStart, local('2026-07-30T12:00:00-07:00')),
      entry('work', local('2026-07-30T13:00:00-07:00'), OPEN_ENTRY_END),
    ]

    expect(totalSince(entries, 'work', blockStart, now)).toBe(3.5 * HOUR)
  })

  it('leaves out other activities and anything before the block opened', () => {
    const now = local('2026-07-30T10:00:00-07:00')
    const entries = [
      // An earlier block of the same activity, already stopped.
      entry('work', local('2026-07-30T07:00:00-07:00'), local('2026-07-30T08:00:00-07:00')),
      entry('work', blockStart, now),
      entry('reading', blockStart, now),
    ]

    expect(totalSince(entries, 'work', blockStart, now)).toBe(1 * HOUR)
  })

  it('spans midnight, because a block is not a calendar period', () => {
    // A sleep timer started at 23:00 and still running at 07:00 is one eight-hour block,
    // not two day-shaped pieces.
    const start = local('2026-07-30T23:00:00-07:00')
    const now = local('2026-07-31T07:00:00-07:00')

    expect(totalSince([entry('sleep', start, OPEN_ENTRY_END)], 'sleep', start, now)).toBe(8 * HOUR)
  })
})

describe('trackedWallClock', () => {
  const day = dayWindow(local('2026-07-30T12:00:00-07:00'))
  const now = local('2026-07-31T00:00:00-07:00')
  const at = (hour: string) => local(`2026-07-30T${hour}:00-07:00`)

  it('is zero with no entries', () => {
    expect(trackedWallClock([], day, now)).toBe(0)
  })

  it('counts overlapping time once', () => {
    const entries = [entry('a', at('09:00'), at('12:00')), entry('b', at('11:00'), at('14:00'))]
    expect(trackedWallClock(entries, day, now)).toBe(5 * HOUR)
  })

  it('joins intervals that merely touch into one run', () => {
    // The opposite of the same-activity storage rule, which leaves these two records
    // separate: as *coverage* they are one continuous five hours.
    const entries = [entry('a', at('09:00'), at('12:00')), entry('a', at('12:00'), at('14:00'))]
    expect(trackedWallClock(entries, day, now)).toBe(5 * HOUR)
  })

  it('keeps disjoint runs apart', () => {
    const entries = [entry('a', at('09:00'), at('10:00')), entry('b', at('11:00'), at('12:00'))]
    expect(trackedWallClock(entries, day, now)).toBe(2 * HOUR)
  })

  it('swallows an interval wholly inside another', () => {
    const entries = [entry('a', at('09:00'), at('17:00')), entry('b', at('10:00'), at('11:00'))]
    expect(trackedWallClock(entries, day, now)).toBe(8 * HOUR)
  })

  it('does not depend on the order entries arrive in', () => {
    const entries = [
      entry('c', at('16:00'), at('17:00')),
      entry('a', at('09:00'), at('12:00')),
      entry('b', at('11:00'), at('14:00')),
    ]
    expect(trackedWallClock(entries, day, now)).toBe(6 * HOUR)
    expect(trackedWallClock([...entries].reverse(), day, now)).toBe(6 * HOUR)
  })
})

describe('untracked', () => {
  it('is zero at 09:00 when every minute since midnight is tracked', () => {
    const now = local('2026-07-31T09:00:00-07:00')
    const today = dayWindow(now)
    const entries = [entry('work', today.start, OPEN_ENTRY_END)]

    expect(untracked(entries, today, now)).toBe(0)
    // The clamp is the whole point: the nominal day still has fifteen hours to run.
    expect(today.end - now).toBe(15 * HOUR)
  })

  it('measures a finished day against its full local length', () => {
    const day = dayWindow(local('2026-07-30T12:00:00-07:00'))
    const entries = [
      entry('work', local('2026-07-30T09:00:00-07:00'), local('2026-07-30T17:00:00-07:00')),
    ]

    expect(untracked(entries, day, local('2026-08-05T00:00:00-07:00'))).toBe(16 * HOUR)
  })

  it('uses 23 hours as the denominator on the spring-forward day', () => {
    const day = dayWindow(local('2026-03-08T12:00:00-08:00'))
    const now = local('2026-03-20T00:00:00-07:00')

    expect(day.end - day.start).toBe(23 * HOUR)
    expect(untracked([], day, now)).toBe(23 * HOUR)
    // 01:00 PST → 04:00 PDT is two hours of wall-clock, the 02:00 hour never happening.
    const across = entry(
      'work',
      local('2026-03-08T01:00:00-08:00'),
      local('2026-03-08T04:00:00-07:00'),
    )
    expect(untracked([across], day, now)).toBe(21 * HOUR)
  })

  it('uses 25 hours as the denominator on the fall-back day', () => {
    const day = dayWindow(local('2026-11-01T12:00:00-08:00'))
    const now = local('2026-11-10T00:00:00-08:00')

    expect(day.end - day.start).toBe(25 * HOUR)
    expect(untracked([], day, now)).toBe(25 * HOUR)
    // 01:00 PDT → 01:00 PST is the repeated hour: one real hour of tracked time.
    const repeated = entry(
      'sleep',
      local('2026-11-01T01:00:00-07:00'),
      local('2026-11-01T01:00:00-08:00'),
    )
    expect(untracked([repeated], day, now)).toBe(24 * HOUR)
  })

  it('reports a whole tracked week as zero untracked, DST week included', () => {
    const week = weekWindow(local('2026-03-10T12:00:00-07:00'))
    const now = local('2026-03-20T00:00:00-07:00')

    expect(week.end - week.start).toBe(7 * 24 * HOUR - HOUR)
    expect(untracked([entry('all', week.start, week.end)], week, now)).toBe(0)
  })
})

describe('periodTotals', () => {
  it('reports the nominal window and the clamped length side by side', () => {
    const now = local('2026-07-31T09:00:00-07:00')
    const today = dayWindow(now)
    const totals = periodTotals([entry('work', today.start, OPEN_ENTRY_END)], today, now)

    // The window is untouched, so a caller can still see the period is in progress.
    expect(totals.window).toEqual(today)
    expect(totals.length).toBe(9 * HOUR)
    expect(totals.tracked).toBe(9 * HOUR)
    expect(totals.untracked).toBe(0)
    expect(totals.perActivity).toEqual(new Map([['work', 9 * HOUR]]))
  })

  it('collapses a window that has not started to zero length', () => {
    const tomorrow = dayWindow(local('2026-08-01T12:00:00-07:00'))
    const totals = periodTotals([], tomorrow, local('2026-07-31T09:00:00-07:00'))

    expect(totals.length).toBe(0)
    expect(totals.untracked).toBe(0)
  })
})

describe('bucketTotals', () => {
  it('returns one row per bucket, in the order given', () => {
    const now = local('2026-07-31T12:00:00-07:00')
    const days = trailingWindows(now, 'day', 3)
    const entries = [
      entry('work', local('2026-07-29T09:00:00-07:00'), local('2026-07-29T10:00:00-07:00')),
      entry('work', local('2026-07-31T08:00:00-07:00'), local('2026-07-31T10:00:00-07:00')),
    ]

    const rows = bucketTotals(entries, days, now)

    expect(rows.map((row) => row.window)).toEqual(days)
    expect(rows.map((row) => row.tracked)).toEqual([HOUR, 0, 2 * HOUR])
    expect(rows.map((row) => row.length)).toEqual([24 * HOUR, 24 * HOUR, 12 * HOUR])
  })

  it('splits a midnight-crossing entry across the two buckets it touches', () => {
    const now = local('2026-08-01T12:00:00-07:00')
    const days = trailingWindows(local('2026-07-30T12:00:00-07:00'), 'day', 2)
    const sleep = entry(
      'sleep',
      local('2026-07-29T23:00:00-07:00'),
      local('2026-07-30T07:00:00-07:00'),
    )

    expect(bucketTotals([sleep], days, now).map((row) => row.tracked)).toEqual([HOUR, 7 * HOUR])
  })
})
