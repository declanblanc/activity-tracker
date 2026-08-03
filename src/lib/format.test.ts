import { describe, expect, it } from 'vitest'
import { formatDuration, formatElapsed } from './format.ts'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

describe('formatElapsed', () => {
  it('pads minutes and seconds, and drops the hour field under an hour', () => {
    expect(formatElapsed(9 * 1000)).toBe('00:09')
    expect(formatElapsed(5 * MINUTE + 9 * 1000)).toBe('05:09')
    expect(formatElapsed(2 * HOUR + 5 * MINUTE + 9 * 1000)).toBe('2:05:09')
  })

  it('does not roll the hour field over at 24', () => {
    expect(formatElapsed(26 * HOUR)).toBe('26:00:00')
  })
})

describe('formatDuration', () => {
  it('drops the hour field under an hour', () => {
    expect(formatDuration(45 * MINUTE)).toBe('45m')
    expect(formatDuration(2 * HOUR + 5 * MINUTE)).toBe('2h 5m')
  })
})
