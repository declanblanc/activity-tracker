/**
 * The shape an activity takes while it is being typed, and the conversions either side of it.
 *
 * Separate from `ActivityForm` so a screen can build a draft without importing a component — and
 * so the form file exports only a component, which is what keeps fast refresh working.
 */
import type { ActivityInput, Measure, Period } from '../data/types.ts'

const HOUR = 60 * 60 * 1000

export type Draft = {
  name: string
  description: string
  icon: string
  color: string
  measure: Measure
  /** As typed: hours for a duration, days for a count. Empty means no goal. */
  targetAmount: string
  targetPeriod: Period
}

export function blankDraft(color: string): Draft {
  return {
    name: '',
    description: '',
    icon: '💪',
    color,
    measure: 'count',
    // A check-off activity defaults to every day, which is what almost every habit is.
    targetAmount: '1',
    targetPeriod: 'day',
  }
}

export function draftFrom(activity: {
  name: string
  description?: string
  icon?: string
  color: string
  measure: Measure
  targetAmount?: number
  targetPeriod?: Period
}): Draft {
  return {
    name: activity.name,
    description: activity.description ?? '',
    icon: activity.icon ?? '💪',
    color: activity.color,
    measure: activity.measure,
    targetAmount:
      activity.targetAmount === undefined
        ? ''
        : String(
            activity.measure === 'duration' ? activity.targetAmount / HOUR : activity.targetAmount,
          ),
    targetPeriod: activity.targetPeriod ?? 'day',
  }
}

/** The draft as the data layer wants it, hours converted back to milliseconds. */
export function toInput(draft: Draft, id?: string): ActivityInput {
  const amount = draft.targetAmount.trim() === '' ? undefined : Number(draft.targetAmount)
  return {
    id,
    name: draft.name,
    description: draft.description,
    icon: draft.icon,
    color: draft.color,
    measure: draft.measure,
    targetAmount:
      amount === undefined ? undefined : draft.measure === 'duration' ? amount * HOUR : amount,
    targetPeriod: amount === undefined ? undefined : draft.targetPeriod,
  }
}

