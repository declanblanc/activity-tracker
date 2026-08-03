import { describe, expect, it, test } from 'vitest'
import { weekGrid, weeksThatFit } from './heatStrip.ts'
import { shiftKey, weekdayOf } from './time.ts'

// Columns are 13px wide with a 3px gap between them, so n weeks measure 16n - 3.
const widthOf = (weeks: number) => weeks * 16 - 3

test('fills the width with whole columns', () => {
  expect(weeksThatFit(widthOf(10))).toBe(10)
  expect(weeksThatFit(widthOf(26))).toBe(26)
})

// The point of the exact fit: one pixel short of the next column must not claim it, or
// the strip overflows its card and the scrollbar this replaced comes back.
test('never claims a column it cannot fully show', () => {
  expect(weeksThatFit(widthOf(11) - 1)).toBe(10)
  expect(weeksThatFit(widthOf(10) + 15)).toBe(10)
  expect(weeksThatFit(widthOf(11))).toBe(11)
})

test('always renders at least one column', () => {
  expect(weeksThatFit(0)).toBe(1)
  expect(weeksThatFit(5)).toBe(1)
})

describe('weekGrid', () => {
  // 2026-08-03 is a Monday.
  const grid = weekGrid('2026-08-03', 4)

  it('returns seven rows per week', () => {
    expect(grid).toHaveLength(28)
  })

  it('starts every column on a Sunday, so each row is one weekday', () => {
    for (let column = 0; column < 4; column++) {
      const first = grid[column * 7]
      expect(first).not.toBeNull()
      expect(weekdayOf(first!)).toBe(0)
    }
  })

  it('places the end date in the final column', () => {
    expect(grid.slice(21)).toContain('2026-08-03')
  })

  it('blanks the days after the end date instead of making them clickable', () => {
    // Monday the 3rd is row 1, so rows 2-6 of the last column are still to come.
    expect(grid.slice(21)).toEqual(['2026-08-02', '2026-08-03', null, null, null, null, null])
  })

  it('runs continuously from the first cell to the end date', () => {
    expect(grid[0]).toBe('2026-07-12')
    for (let i = 1; i < 23; i++) {
      expect(grid[i]).toBe(shiftKey(grid[i - 1]!, 1))
    }
  })

  it('spans a DST transition without gaps or repeats', () => {
    const yearGrid = weekGrid('2026-12-31', 53).filter((key) => key !== null)
    expect(new Set(yearGrid).size).toBe(yearGrid.length)
  })
})
