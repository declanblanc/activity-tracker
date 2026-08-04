import { describe, expect, it } from 'vitest'
import { GOAL_SHAPES, applyGoalShape, blankDraft, goalShapeOf } from './activityDraft.ts'

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
})
