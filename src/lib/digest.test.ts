import { describe, expect, it } from 'vitest'
import { NOT_DELETED, type Activity } from '../data/types.ts'
import { buildDigest, type ActivityDigestInput } from './digest.ts'
import { trailingWindows } from './time.ts'

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

describe('buildDigest', () => {
  const now = local('2026-07-31T09:00:00-07:00')
  const weeks = trailingWindows(now, 'week', 12)

  const trendOf = (...hours: number[]): ActivityDigestInput['trend'] =>
    weeks.slice(weeks.length - hours.length).map((window, index) => ({
      window,
      total: hours[index] * HOUR,
    }))

  it('leads with a goal that would break an existing streak', () => {
    const input: ActivityDigestInput = {
      activity: activity({}),
      goal: { target: 10 * HOUR, total: 4 * HOUR, streak: { current: 5, longest: 5 } },
      trend: trendOf(10, 10, 10, 10),
    }

    const [first] = buildDigest([input], 'week', now)
    expect(first.text).toContain('Deep Work')
    expect(first.text).toContain('6h more')
    expect(first.text).toContain('5-week streak')
  })

  it('says nothing about a goal that is unmet with no streak at stake', () => {
    const input: ActivityDigestInput = {
      activity: activity({}),
      goal: { target: 10 * HOUR, total: 4 * HOUR, streak: { current: 0, longest: 3 } },
      trend: trendOf(10, 10, 10, 10),
    }

    expect(buildDigest([input], 'week', now)).toEqual([])
  })

  it('calls out a streak that just became the longest yet', () => {
    const input: ActivityDigestInput = {
      activity: activity({ name: 'Gym', measure: 'count' }),
      goal: { target: 1, total: 1, streak: { current: 6, longest: 6 } },
      trend: trendOf(1, 1, 1, 1),
    }

    const [first] = buildDigest([input], 'week', now)
    expect(first.text).toBe("Gym's streak is at 6 weeks, its longest yet.")
  })

  it('does not call out a streak still short of its own record', () => {
    const input: ActivityDigestInput = {
      activity: activity({}),
      goal: { target: 1, total: 1, streak: { current: 3, longest: 6 } },
      trend: trendOf(1, 1, 1, 1),
    }

    expect(buildDigest([input], 'week', now)).toEqual([])
  })

  it('flags the last closed period moving well off its own average', () => {
    // Four closed weeks averaging 10h, then a fifth (browsed-to, still open) week at 3h —
    // the drop is read against the closed week before it, not the open one.
    const input: ActivityDigestInput = {
      activity: activity({}),
      trend: [
        { window: weeks[weeks.length - 5], total: 10 * HOUR },
        { window: weeks[weeks.length - 4], total: 10 * HOUR },
        { window: weeks[weeks.length - 3], total: 10 * HOUR },
        { window: weeks[weeks.length - 2], total: 4 * HOUR },
        { window: weeks[weeks.length - 1], total: 3 * HOUR },
      ],
    }

    const [first] = buildDigest([input], 'week', now)
    expect(first.text).toBe('Deep Work was down 60% last week vs its 3-week average.')
  })

  it('never scores the in-progress period as a mover, even at zero', () => {
    const input: ActivityDigestInput = {
      activity: activity({}),
      trend: [
        { window: weeks[weeks.length - 5], total: 10 * HOUR },
        { window: weeks[weeks.length - 4], total: 10 * HOUR },
        { window: weeks[weeks.length - 3], total: 10 * HOUR },
        { window: weeks[weeks.length - 2], total: 10 * HOUR },
        { window: weeks[weeks.length - 1], total: 0 },
      ],
    }

    expect(buildDigest([input], 'week', now)).toEqual([])
  })

  it('skips a mover with too little baseline history', () => {
    const input: ActivityDigestInput = {
      activity: activity({}),
      trend: trendOf(10, 2),
    }

    expect(buildDigest([input], 'week', now)).toEqual([])
  })

  it('ranks a streak worth protecting above a mover, and caps the total', () => {
    const protect: ActivityDigestInput = {
      activity: activity({ id: 'a', name: 'Deep Work' }),
      goal: { target: 10 * HOUR, total: 4 * HOUR, streak: { current: 2, longest: 2 } },
      trend: trendOf(10, 10, 10, 10),
    }
    const mover: ActivityDigestInput = {
      activity: activity({ id: 'b', name: 'Reading', measure: 'count' }),
      trend: [
        { window: weeks[weeks.length - 5], total: 6 },
        { window: weeks[weeks.length - 4], total: 6 },
        { window: weeks[weeks.length - 3], total: 6 },
        { window: weeks[weeks.length - 2], total: 1 },
        { window: weeks[weeks.length - 1], total: 5 },
      ],
    }

    const digest = buildDigest([protect, mover], 'week', now, 1)
    expect(digest).toHaveLength(1)
    expect(digest[0].text).toContain('Deep Work')
  })
})
