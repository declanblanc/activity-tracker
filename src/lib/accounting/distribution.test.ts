import { describe, expect, it } from 'vitest'
import { percentileRank } from './distribution.ts'

describe('percentileRank', () => {
  it('reads how many of the series a value beats', () => {
    expect(percentileRank([1, 2, 3, 4], 3.5)).toBe(0.75)
  })

  it('is 0 for the lowest value in its own series', () => {
    expect(percentileRank([1, 2, 3], 1)).toBe(0)
  })

  it('is 1 for a value above everything in the series', () => {
    expect(percentileRank([1, 2, 3], 10)).toBe(1)
  })

  it('does not count a tie as a win', () => {
    expect(percentileRank([5, 5, 5], 5)).toBe(0)
  })

  it('is 0 for an empty series rather than dividing by zero', () => {
    expect(percentileRank([], 5)).toBe(0)
  })
})
