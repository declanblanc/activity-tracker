import { describe, expect, it } from 'vitest'
import { NOT_DELETED, completionId, type Activity, type Completion, type Entry } from '../data/types.ts'
import { personalBests } from './bests.ts'

const HOUR = 60 * 60 * 1000
const local = (iso: string) => new Date(iso).getTime()

function activity(fields: Partial<Activity>): Activity {
  return {
    id: 'a',
    name: 'Deep Work',
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

describe('personalBests', () => {
  const now = local('2026-07-31T09:00:00-07:00')

  it('is null for an activity with nothing recorded', () => {
    expect(personalBests(activity({}), [], [], now)).toBeNull()
  })

  it('finds the lifetime total and best single day for a timed activity with no goal', () => {
    const entries = [
      entry(local('2026-01-05T09:00:00-08:00'), local('2026-01-05T13:00:00-08:00')),
      entry(local('2026-07-30T09:00:00-07:00'), local('2026-07-30T10:00:00-07:00')),
    ]

    const bests = personalBests(activity({}), entries, [], now)

    expect(bests?.lifetimeTotal).toBe(5 * HOUR)
    expect(bests?.bestPeriod).toBe(4 * HOUR)
    expect(bests?.longestStreak).toBeUndefined()
  })

  it('reports the longest streak ever for a goal older than STREAK_PERIODS covers', () => {
    // Fourteen straight weekly-goal weeks, well past the twelve the screen normally reads.
    const timed = activity({ targetAmount: 2 * HOUR, targetPeriod: 'week' })
    const entries = Array.from({ length: 14 }, (_, week) =>
      entry(
        local('2026-01-05T09:00:00-08:00') + week * 7 * 24 * HOUR,
        local('2026-01-05T09:00:00-08:00') + week * 7 * 24 * HOUR + 3 * HOUR,
      ),
    )

    const bests = personalBests(timed, entries, [], now)

    expect(bests?.longestStreak).toBe(14)
  })

  it('gives a plain check-off an implicit daily goal, matching FocusSummary', () => {
    const habit = activity({ measure: 'count' })
    const completions = [completion('2026-07-28'), completion('2026-07-29'), completion('2026-07-30')]

    const bests = personalBests(habit, [], completions, now)

    expect(bests?.longestStreak).toBe(3)
    expect(bests?.lifetimeTotal).toBe(3)
  })

  it('does not let an explicit false completion count as a logged day', () => {
    const habit = activity({ measure: 'count' })
    const completions = [completion('2026-07-28'), completion('2026-07-29', false)]

    const bests = personalBests(habit, [], completions, now)

    expect(bests?.lifetimeTotal).toBe(1)
  })
})
