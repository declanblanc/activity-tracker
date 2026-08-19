import { describe, expect, it } from 'vitest'
import { GOAL_SHAPES, applyGoalShape, blankDraft, draftFrom, goalShapeOf, toInput } from './activityDraft.ts'

const base = blankDraft('#38bdf8')

describe('goalShapeOf', () => {
  it('reads a daily check-off as "once", never days-per-day', () => {
    expect(goalShapeOf({ measure: 'count', targetPeriod: 'day' })).toBe('once')
  })

  it('reads the other unit/period pairs', () => {
    expect(goalShapeOf({ measure: 'count', targetPeriod: 'week' })).toBe('days-week')
    expect(goalShapeOf({ measure: 'duration', targetPeriod: 'day' })).toBe('hours-day')
    expect(goalShapeOf({ measure: 'duration', targetPeriod: 'month' })).toBe('hours-month')
  })
})

describe('applyGoalShape', () => {
  it('forces the amount to 1 for "once a day"', () => {
    const changed = applyGoalShape({ ...base, targetAmount: '9' }, 'once')
    expect([changed.measure, changed.targetPeriod, changed.targetAmount]).toEqual([
      'count',
      'day',
      '1',
    ])
  })

  it('keeps the typed amount when switching between real shapes', () => {
    const changed = applyGoalShape({ ...base, targetAmount: '3' }, 'hours-week')
    expect([changed.measure, changed.targetPeriod, changed.targetAmount]).toEqual([
      'duration',
      'week',
      '3',
    ])
  })

  it('seeds an amount of 1 when leaving "once a day" with nothing typed', () => {
    const changed = applyGoalShape({ ...base, targetAmount: '' }, 'days-week')
    expect(changed.targetAmount).toBe('1')
  })

  it('round-trips every shape through goalShapeOf', () => {
    for (const shape of GOAL_SHAPES) {
      expect(goalShapeOf(applyGoalShape(base, shape.value))).toBe(shape.value)
    }
  })

  // The decoupling, pinned: the goal picks the scored axis, not the card.
  it('leaves the display mode alone', () => {
    for (const shape of GOAL_SHAPES) {
      expect(applyGoalShape({ ...base, display: 'timer' }, shape.value).display).toBe('timer')
    }
  })
})

describe('display mode', () => {
  it('starts a new activity as a habit card', () => {
    expect(base.display).toBe('habit')
  })

  it('reads a stored mode, and falls back to the measure without one', () => {
    const stored = { name: 'Read', color: '#38bdf8', measure: 'count' as const }

    expect(draftFrom({ ...stored, display: 'timer' }).display).toBe('timer')
    expect(draftFrom(stored).display).toBe('habit')
    expect(draftFrom({ ...stored, measure: 'duration' }).display).toBe('timer')
  })

  it('carries the mode back to the data layer', () => {
    expect(toInput({ ...base, display: 'timer' }).display).toBe('timer')
  })
})
