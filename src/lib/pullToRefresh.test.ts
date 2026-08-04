import { describe, expect, it } from 'vitest'
import { pullDistance, THRESHOLD } from './pullToRefresh.ts'

describe('pullDistance', () => {
  it('is zero for a finger that has not moved down', () => {
    expect(pullDistance(0)).toBe(0)
    expect(pullDistance(-40)).toBe(0)
  })

  it('applies resistance, so the indicator moves less than the finger', () => {
    expect(pullDistance(40)).toBe(20)
  })

  it('clamps however hard you pull, and the ceiling clears the trigger threshold', () => {
    const far = pullDistance(100_000)
    expect(far).toBe(110)
    expect(far).toBeGreaterThanOrEqual(THRESHOLD)
  })
})
