import { describe, expect, it } from 'vitest'
import { expectedSoFar } from './owed.ts'

const HOUR = 60 * 60 * 1000
const WEEK = 7 * 24 * HOUR

describe('expectedSoFar', () => {
  it('prorates the target continuously across elapsed time', () => {
    // 40h/week, three and a half weeks in: 40 * 3.5 = 140 hours.
    expect(expectedSoFar(40 * HOUR, WEEK, 3.5 * WEEK)).toBe(140 * HOUR)
  })

  it('owes exactly the target at one whole period', () => {
    expect(expectedSoFar(40 * HOUR, WEEK, WEEK)).toBe(40 * HOUR)
  })

  it('owes nothing before any time has elapsed', () => {
    expect(expectedSoFar(40 * HOUR, WEEK, 0)).toBe(0)
  })

  it('owes nothing for a window still in the future', () => {
    expect(expectedSoFar(40 * HOUR, WEEK, -2 * HOUR)).toBe(0)
  })

  it('owes nothing when there is no period to prorate over', () => {
    expect(expectedSoFar(40 * HOUR, 0, WEEK)).toBe(0)
  })
})
