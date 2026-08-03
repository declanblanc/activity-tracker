import { describe, expect, it } from 'vitest'
import { NOT_DELETED, type Activity } from '../../data/types.ts'
import { trailingWindows } from '../time.ts'
import { streaks, targetAt, type ScoredPeriod } from './goals.ts'

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

describe('targetAt', () => {
  const weekly = activity({ targetAmount: 10 * HOUR, targetPeriod: 'week' })

  it('scores a target at its own period', () => {
    expect(targetAt(weekly, 'week')).toBe(10 * HOUR)
  })

  it('scores nothing at any other period, rather than pro-rating', () => {
    expect(targetAt(weekly, 'day')).toBeNull()
    expect(targetAt(weekly, 'month')).toBeNull()
  })

  it('scores nothing for an activity with no target', () => {
    expect(targetAt(activity({}), 'week')).toBeNull()
    expect(targetAt(activity({ targetPeriod: 'week' }), 'week')).toBeNull()
  })

  it('reads a count target the same way, in days rather than milliseconds', () => {
    // The one function, both measures: a target is a number to reach in a period, and
    // nothing here needs to know which unit it is counting in.
    const threeDaysAWeek = activity({ measure: 'count', targetAmount: 3, targetPeriod: 'week' })
    expect(targetAt(threeDaysAWeek, 'week')).toBe(3)
    expect(targetAt(threeDaysAWeek, 'day')).toBeNull()
  })
})

describe('streaks', () => {
  const now = local('2026-07-31T09:00:00-07:00')
  /** Seven days ending with today, which is still in progress at `now`. */
  const days = trailingWindows(now, 'day', 7)
  const target = 2 * HOUR

  /** Totals in hours, oldest first, parallel to `days`. */
  const scored = (...hours: number[]): ScoredPeriod[] =>
    hours.map((value, index) => ({ window: days[index], total: value * HOUR }))

  it('counts consecutive met periods up to the last closed one', () => {
    // Sat–Thu met, and today's 0 is skipped because today has not finished.
    expect(streaks(scored(0, 2, 3, 2, 2, 4, 0), target, now)).toEqual({ current: 5, longest: 5 })
  })

  it('resets the current streak on a missed period', () => {
    expect(streaks(scored(3, 3, 3, 1, 2, 2, 9), target, now)).toEqual({ current: 3, longest: 3 })
  })

  it('remembers the longest run after the current one is broken', () => {
    expect(streaks(scored(4, 4, 4, 4, 0, 2, 0), target, now)).toEqual({ current: 1, longest: 4 })
  })

  it('skips an unmet in-progress period rather than counting it as a miss', () => {
    // A day half-done is not a day missed; the run through yesterday still stands.
    const met = streaks(scored(2, 2, 2, 2, 2, 2, 0), target, now)
    expect(met.current).toBe(6)

    // The same run scored after the day closes does count the seventh period.
    const tomorrow = local('2026-08-01T00:00:00-07:00')
    expect(streaks(scored(2, 2, 2, 2, 2, 2, 2), target, tomorrow).current).toBe(7)
  })

  it('counts an in-progress period that has already met its target', () => {
    // Ticking the last box of the day is exactly when the number is supposed to move.
    // The sibling time tracker waited for the period to close and was wrong to.
    expect(streaks(scored(0, 0, 0, 0, 0, 0, 5), target, now)).toEqual({ current: 1, longest: 1 })
  })

  it('extends a run through a met period that is still open', () => {
    expect(streaks(scored(0, 2, 2, 2, 2, 2, 2), target, now)).toEqual({ current: 6, longest: 6 })
  })

  it('does not let a met in-progress period revive a broken run', () => {
    // Yesterday was missed, so today's hit starts a new run of one rather than continuing.
    expect(streaks(scored(2, 2, 2, 2, 2, 0, 4), target, now)).toEqual({ current: 1, longest: 5 })
  })

  it('is zero when nothing is met, and over no periods at all', () => {
    expect(streaks(scored(0, 1, 0, 1, 0, 1, 0), target, now)).toEqual({ current: 0, longest: 0 })
    expect(streaks([], target, now)).toEqual({ current: 0, longest: 0 })
  })

  it('counts a period met exactly on the target', () => {
    expect(streaks(scored(2, 2, 0, 0, 0, 0, 0), target, now).longest).toBe(2)
  })

  it('counts weeks for a weekly target, whatever scale is on screen', () => {
    const weeks = trailingWindows(now, 'week', 4)
    const periods = [12, 11, 10, 1].map((hours, index) => ({
      window: weeks[index],
      total: hours * HOUR,
    }))

    // The fourth week contains `now` and is still short, so its single hour is not a miss.
    expect(streaks(periods, 10 * HOUR, now)).toEqual({ current: 3, longest: 3 })
  })

  it('counts an in-progress week that has already hit its target', () => {
    const weeks = trailingWindows(now, 'week', 4)
    const periods = [12, 11, 10, 10].map((hours, index) => ({
      window: weeks[index],
      total: hours * HOUR,
    }))
    expect(streaks(periods, 10 * HOUR, now)).toEqual({ current: 4, longest: 4 })
  })
})

// The same function, scoring days rather than milliseconds. These are the habit tracker's
// streak semantics, which used to live in its own `stats.ts` — they survive as cases over
// the one shared implementation rather than as a second one.
describe('streaks over a count activity', () => {
  const now = local('2026-07-31T09:00:00-07:00')
  const days = trailingWindows(now, 'day', 7)
  const weeks = trailingWindows(now, 'week', 4)

  /** One check-off per day, oldest first: 1 for a logged day, 0 for a missed one. */
  const daily = (...logged: number[]): ScoredPeriod[] =>
    logged.map((total, index) => ({ window: days[index], total }))

  it('counts a run of logged days, with today unlogged', () => {
    // The grace rule: today is not logged yet, so the run through yesterday stands.
    expect(streaks(daily(0, 1, 1, 1, 1, 1, 0), 1, now)).toEqual({ current: 5, longest: 5 })
  })

  it('moves the moment today is ticked', () => {
    expect(streaks(daily(0, 1, 1, 1, 1, 1, 1), 1, now)).toEqual({ current: 6, longest: 6 })
  })

  it('is zero when both today and yesterday were missed', () => {
    expect(streaks(daily(1, 1, 1, 1, 1, 0, 0), 1, now)).toEqual({ current: 0, longest: 5 })
  })

  it('treats a cleared day as a miss, not as an absence', () => {
    // A `done: false` completion is a recorded decision. `lib/days.ts` maps it to 0, and a
    // 0 breaks the run exactly as a day with no row at all would.
    expect(streaks(daily(1, 1, 0, 1, 1, 1, 1), 1, now)).toEqual({ current: 4, longest: 4 })
  })

  it('counts a weekly target from days scattered through the week', () => {
    // Three days a week, met in three of the four weeks. A daily reading of the same data
    // would report a streak of 1 at best — the period size is what makes it 3.
    const periods = [3, 4, 3, 1].map((total, index) => ({ window: weeks[index], total }))
    expect(streaks(periods, 3, now)).toEqual({ current: 3, longest: 3 })
  })

  it('counts an over-achieving week once, not once per extra day', () => {
    const periods = [7, 7].map((total, index) => ({ window: weeks[index], total }))
    expect(streaks(periods, 3, now).longest).toBe(2)
  })

  it('resets the longest run on a missed week', () => {
    const periods = [3, 3, 0, 3].map((total, index) => ({ window: weeks[index], total }))
    // The fourth week is in progress and already met, so it counts.
    expect(streaks(periods, 3, now)).toEqual({ current: 1, longest: 2 })
  })

  it('counts a streak straight through a DST transition', () => {
    // Nov 1 2026 is a 25-hour day. `trailingWindows` makes every window a real local day,
    // so the run neither skips nor repeats one.
    const dstNow = local('2026-11-03T09:00:00-08:00')
    const dstDays = trailingWindows(dstNow, 'day', 7)
    const periods = [1, 1, 1, 1, 1, 1, 1].map((total, index) => ({
      window: dstDays[index],
      total,
    }))
    expect(streaks(periods, 1, dstNow)).toEqual({ current: 7, longest: 7 })
  })
})
