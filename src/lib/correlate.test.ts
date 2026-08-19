import { describe, expect, it } from 'vitest'
import type { DayPair } from './days.ts'
import { describeCorrelation, pearson } from './correlate.ts'

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
