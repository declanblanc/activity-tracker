import { describe, expect, it } from 'vitest'
import type { DateKey } from '../data/types.ts'
import { describeRhythm, weekdayProfile } from './rhythm.ts'
import { dateKey, dayWindowsIn, shiftKey } from './time.ts'

const HOUR = 60 * 60 * 1000
const local = (iso: string) => new Date(iso).getTime()

const now = local('2026-08-18T09:00:00-07:00')
/** Eight weeks back through yesterday, plus the day in progress. */
const days = dayWindowsIn({ start: local('2026-06-21T00:00:00-07:00'), end: now })

/** Every day in the range, amounted by its weekday. Sunday 0. */
function byWeekday(perWeekday: number[]): Map<DateKey, number> {
  const amounts = new Map<DateKey, number>()
  for (const day of days) {
    amounts.set(dateKey(day.start), perWeekday[new Date(day.start).getDay()])
  }
  return amounts
}

describe('weekdayProfile', () => {
  it('groups amounts by weekday, Sunday first', () => {
    const profile = weekdayProfile(byWeekday([1, 2, 3, 4, 5, 6, 7]), days, now)

    expect(profile).toHaveLength(7)
    expect(profile.map((slot) => slot.mean)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(profile[0].weekday).toBe(0)
  })

  it('leaves the day still running out of its own weekday', () => {
    // Today is a Tuesday, and it has nothing on it yet.
    const amounts = byWeekday([9, 9, 9, 9, 9, 9, 9])
    amounts.set(dateKey(now), 0)

    const profile = weekdayProfile(amounts, days, now)

    // Every closed Tuesday still averages 9 — the empty one in progress is not among them.
    expect(profile[2].mean).toBe(9)
    // ...and it is not counted as a sample either.
    expect(profile[2].days).toBe(profile[3].days)
  })

  it('reports a weekday it has never seen as zero rather than dividing by none', () => {
    const profile = weekdayProfile(new Map(), dayWindowsIn({ start: now - 1, end: now }), now)

    expect(profile.every((slot) => Number.isFinite(slot.mean))).toBe(true)
  })
})

describe('describeRhythm', () => {
  it('names the weekday that stands furthest from the rest', () => {
    const profile = weekdayProfile(byWeekday([4, 4, 0, 4, 4, 4, 4]), days, now)

    expect(describeRhythm(profile, 'duration')).toMatch(/Tuesday is your quietest day/)
  })

  it('names a peak when the peak is the bigger deviation', () => {
    const profile = weekdayProfile(byWeekday([1, 1, 1, 1, 1, 12, 1]), days, now)

    expect(describeRhythm(profile, 'duration')).toMatch(/Friday is your strongest day/)
  })

  it('says nothing about a level week', () => {
    const profile = weekdayProfile(byWeekday([3, 3, 3, 3, 3, 3, 3]), days, now)

    expect(describeRhythm(profile, 'duration')).toBeNull()
  })

  it('says nothing about a week with nothing in it', () => {
    const profile = weekdayProfile(byWeekday([0, 0, 0, 0, 0, 0, 0]), days, now)

    expect(describeRhythm(profile, 'count')).toBeNull()
  })

  it('says nothing until every weekday has been seen a few times', () => {
    const oneWeek = dayWindowsIn({ start: local('2026-08-09T00:00:00-07:00'), end: now })
    const amounts = new Map<DateKey, number>()
    for (const day of oneWeek) amounts.set(dateKey(day.start), 5)
    amounts.set(shiftKey(dateKey(now), -2), 0)

    expect(describeRhythm(weekdayProfile(amounts, oneWeek, now), 'duration')).toBeNull()
  })

  it('puts a count in days and a duration in hours', () => {
    const counted = weekdayProfile(byWeekday([1, 1, 0, 1, 1, 1, 1]), days, now)
    const timed = weekdayProfile(byWeekday([2 * HOUR, 2 * HOUR, 0, 2 * HOUR, 2 * HOUR, 2 * HOUR, 2 * HOUR]), days, now)

    expect(describeRhythm(counted, 'count')).toMatch(/days/)
    expect(describeRhythm(timed, 'duration')).toMatch(/h/)
  })
})
