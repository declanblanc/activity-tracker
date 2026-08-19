import { describe, expect, it } from 'vitest'
import type { DayPair } from './days.ts'
import { describeCorrelation, pearson, strongestLink } from './correlate.ts'

const HOUR = 60 * 60 * 1000

function points(pairs: [number, number][]): DayPair[] {
  return pairs.map(([x, y], index) => ({ day: `2026-08-${String(index + 1).padStart(2, '0')}`, x, y }))
}

describe('pearson', () => {
  it('is 1 for a perfectly increasing relationship', () => {
    expect(pearson([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1)
  })

  it('is -1 for a perfectly inverse relationship', () => {
    expect(pearson([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1)
  })

  it('is 0 when one series never varies', () => {
    expect(pearson([1, 2, 3], [5, 5, 5])).toBe(0)
  })

  it('is 0 for an empty series', () => {
    expect(pearson([], [])).toBe(0)
  })
})

describe('describeCorrelation', () => {
  it('reports too few overlapping days rather than guessing from them', () => {
    expect(describeCorrelation(points([[6, 1]]), 'Sleep', 'Deep Work', 'duration')).toBeNull()
  })

  it('says nothing when the second series does not move with the first at all', () => {
    const flat = points([
      [6, 2 * HOUR],
      [7, 2 * HOUR],
      [5, 2 * HOUR],
      [8, 2 * HOUR],
      [6, 2 * HOUR],
      [7, 2 * HOUR],
    ])
    expect(describeCorrelation(flat, 'Sleep', 'Deep Work', 'duration')).toBeNull()
  })

  it('names the gap between below- and above-median days for a real relationship', () => {
    const linked = points([
      [4, 1 * HOUR],
      [5, 1 * HOUR],
      [9, 3 * HOUR],
      [10, 3 * HOUR],
      [4.5, 1 * HOUR],
      [9.5, 3 * HOUR],
    ])
    const text = describeCorrelation(linked, 'Sleep', 'Deep Work', 'duration')
    expect(text).toContain('Sleep')
    expect(text).toContain('Deep Work')
    expect(text).toContain('more')
    expect(text).toContain('2h')
    expect(text).toContain('6 overlapping days')
  })

  it('formats the gap in the second activity\'s own measure', () => {
    const linked = points([
      [4, 0],
      [5, 0],
      [9, 1],
      [10, 1],
      [4.5, 0],
      [9.5, 1],
    ])
    const text = describeCorrelation(linked, 'Sleep', 'Gym', 'count')
    expect(text).toContain('1 day')
  })
})

describe('strongestLink', () => {
  /** `[1, 0, 1, ...]` from 2026-08-01 forwards. */
  const series = (values: number[]) =>
    new Map(values.map((value, index) => [`2026-08-${String(index + 1).padStart(2, '0')}`, value]))

  const subject = { label: 'Deep work', days: series([1, 2, 3, 4, 5, 6, 7, 8]) }

  it('picks the most linear partner among several', () => {
    const link = strongestLink(subject, [
      // Moves with the subject almost exactly.
      { label: 'Coffee', measure: 'duration', days: series([2, 4, 6, 8, 10, 12, 14, 16]) },
      // Wanders.
      { label: 'Guitar', measure: 'duration', days: series([9, 1, 8, 2, 7, 3, 6, 4]) },
    ])

    expect(link).toContain('Coffee')
  })

  it('stays quiet when nothing clears the bar', () => {
    const link = strongestLink(subject, [
      { label: 'Guitar', measure: 'duration', days: series([5, 5, 5, 5, 5, 5, 5, 5]) },
    ])

    expect(link).toBeNull()
  })

  it('stays quiet with no partners at all', () => {
    expect(strongestLink(subject, [])).toBeNull()
  })
})
