import { describe, expect, it } from 'vitest'
import type { DateKey } from '../data/types.ts'
import { onPace, pace } from './pace.ts'
import { periodWindow, trailingWindows } from './time.ts'

const HOUR = 60 * 60 * 1000
const local = (iso: string) => new Date(iso).getTime()

/** `{ '2026-08-16': 3, ... }` as the map `pace` reads. */
const amountsOf = (rows: Record<string, number>): Map<DateKey, number> =>
  new Map(Object.entries(rows))

describe('pace', () => {
  // Tuesday morning, two days into a week that starts on Sunday.
  const now = local('2026-08-18T09:00:00-07:00')
  const [previous, week] = trailingWindows(now, 'week', 2)

  it('pairs the same count of closed days on both sides', () => {
    const amounts = amountsOf({
      // Last week: Sunday and Monday, then a big Wednesday it has no business lending.
      '2026-08-09': 2,
      '2026-08-10': 3,
      '2026-08-12': 40,
      // This week: Sunday and Monday closed, Tuesday still running.
      '2026-08-16': 4,
      '2026-08-17': 5,
      '2026-08-18': 1,
    })

    const result = pace(amounts, week, previous, now)

    expect(result.inProgress).toBe(true)
    expect(result.daysClosed).toBe(2)
    expect(result.daysTotal).toBe(7)
    // Everything recorded, the day in progress included — the number on screen.
    expect(result.soFar).toBe(10)
    // Two closed days against two closed days. Wednesday's 40 is not in it.
    expect(result.comparison).toEqual({ now: 9, then: 5 })
  })

  it('has nothing to compare on a day still running', () => {
    const amounts = amountsOf({ '2026-08-17': 6, '2026-08-18': 2 })
    const [yesterday, today] = trailingWindows(now, 'day', 2)

    const result = pace(amounts, today, yesterday, now)

    expect(result.inProgress).toBe(true)
    expect(result.daysClosed).toBe(0)
    expect(result.soFar).toBe(2)
    // The old bug: 2 against yesterday's 6, reported as a 67% collapse at 9am.
    expect(result.comparison).toBeNull()
    expect(result.projected).toBeNull()
  })

  it('compares a closed period in full', () => {
    const amounts = amountsOf({ '2026-08-09': 2, '2026-08-10': 3, '2026-08-16': 4 })

    const result = pace(amounts, previous, trailingWindows(previous.start, 'week', 2)[0], now)

    expect(result.inProgress).toBe(false)
    expect(result.daysClosed).toBe(7)
    expect(result.soFar).toBe(5)
    expect(result.comparison?.now).toBe(5)
    // A finished period projects to exactly what it holds.
    expect(result.projected).toBe(5)
  })

  it('projects from the closed days, never below what is already recorded', () => {
    const amounts = amountsOf({ '2026-08-16': 2 * HOUR, '2026-08-17': 2 * HOUR })

    const result = pace(amounts, week, previous, now)

    // 2h a day across seven days.
    expect(result.projected).toBe(14 * HOUR)
  })

  it('never projects below the day in progress', () => {
    // A quiet weekend and then one enormous Tuesday: the closed-day rate is beneath it.
    const amounts = amountsOf({ '2026-08-18': 12 * HOUR })

    const result = pace(amounts, week, previous, now)

    expect(result.soFar).toBe(12 * HOUR)
    expect(result.projected).toBe(12 * HOUR)
  })

  it('reads a window still to come as untouched', () => {
    const future = periodWindow(local('2026-09-06T12:00:00-07:00'), 'week')

    const result = pace(new Map(), future, week, now)

    expect(result.inProgress).toBe(false)
    expect(result.daysClosed).toBe(0)
    expect(result.comparison).toBeNull()
  })

  it('pairs by day index across months of different lengths', () => {
    const marchish = local('2026-03-02T09:00:00-08:00')
    const [february, march] = trailingWindows(marchish, 'month', 2)
    const amounts = amountsOf({ '2026-02-01': 4, '2026-03-01': 7 })

    const result = pace(amounts, march, february, marchish)

    expect(result.daysClosed).toBe(1)
    expect(result.comparison).toEqual({ now: 7, then: 4 })
  })
})

describe('onPace', () => {
  const now = local('2026-08-18T09:00:00-07:00')
  const [previous, week] = trailingWindows(now, 'week', 2)

  it('asks for the closed days worth, not the day in progress', () => {
    // Two of seven days closed, so a 7h week wants 2h by now.
    const behind = pace(amountsOf({ '2026-08-16': 1 * HOUR }), week, previous, now)
    const ahead = pace(amountsOf({ '2026-08-16': 3 * HOUR }), week, previous, now)

    expect(onPace(behind, 7 * HOUR)).toBe(false)
    expect(onPace(ahead, 7 * HOUR)).toBe(true)
  })

  it('never calls a day behind before it has run out', () => {
    const [yesterday, today] = trailingWindows(now, 'day', 2)
    const nothing = pace(new Map(), today, yesterday, now)

    expect(onPace(nothing, 4 * HOUR)).toBe(true)
  })
})
