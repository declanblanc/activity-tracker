/**
 * The shape an activity takes while it is being typed, and the conversions either side of it.
 *
 * Separate from `ActivityForm` so a screen can build a draft without importing a component — and
 * so the form file exports only a component, which is what keeps fast refresh working.
 */
import { displayMode } from '../data/types.ts'
import type { ActivityInput, DisplayMode, Measure, Period } from '../data/types.ts'

const HOUR = 60 * 60 * 1000

export type Draft = {
  name: string
  description: string
  icon: string
  color: string
  /**
   * The scored axis — which axis the streak, the "total" and the sheet's lead layout are about.
   * Set by the goal shape while a goal is on. While one is off it is not the user's to set: the
   * axis follows the Display mode, so `toInput` derives it and this field is ignored.
   */
  measure: Measure
  /** Which card the Activities list draws. One or the other. See `Activity.display`. */
  display: DisplayMode
  /** Whether this activity is scored against a target at all. On by default; see `blankDraft`. */
  hasGoal: boolean
  /** As typed: hours for a duration, days for a count. Meaningful only while `hasGoal`. */
  targetAmount: string
  targetPeriod: Period
}

/**
 * The six goal shapes the form offers, and nothing else. `days` × `day` is missing on purpose:
 * a day can only be checked off once, so the sole days-per-day goal is "once", which is its own
 * named shape with a fixed amount. Every other combination of a unit and a period is a real goal.
 *
 * The shape encodes a `(measure, period)` pair — `measure` picks the unit (days vs hours) — so
 * this list is the single source of which pairs are sayable while `hasGoal` is on.
 */
export type GoalShape =
  | 'once'
  | 'days-week'
  | 'days-month'
  | 'hours-day'
  | 'hours-week'
  | 'hours-month'

export const GOAL_SHAPES: { value: GoalShape; measure: Measure; period: Period; label: string }[] =
  [
    { value: 'once', measure: 'count', period: 'day', label: 'Once a day' },
    { value: 'days-week', measure: 'count', period: 'week', label: 'days per week' },
    { value: 'days-month', measure: 'count', period: 'month', label: 'days per month' },
    { value: 'hours-day', measure: 'duration', period: 'day', label: 'hours per day' },
    { value: 'hours-week', measure: 'duration', period: 'week', label: 'hours per week' },
    { value: 'hours-month', measure: 'duration', period: 'month', label: 'hours per month' },
  ]

/** Which shape a draft's goal currently is. A count scored by day is always "once a day". */
export function goalShapeOf(draft: Pick<Draft, 'measure' | 'targetPeriod'>): GoalShape {
  if (draft.measure === 'count' && draft.targetPeriod === 'day') return 'once'
  const unit = draft.measure === 'count' ? 'days' : 'hours'
  return `${unit}-${draft.targetPeriod}` as GoalShape
}

/**
 * Move a draft to a goal shape: set its measure and period, and force the amount to 1 for
 * "once a day", whose count is not the user's to set. Switching between the other shapes keeps
 * the typed number, reinterpreting it in the new unit — which is what the user is asking for by
 * changing the unit directly.
 */
export function applyGoalShape(draft: Draft, value: GoalShape): Draft {
  const shape = GOAL_SHAPES.find((option) => option.value === value) ?? GOAL_SHAPES[0]
  return {
    ...draft,
    measure: shape.measure,
    targetPeriod: shape.period,
    targetAmount: shape.value === 'once' ? '1' : draft.targetAmount.trim() === '' ? '1' : draft.targetAmount,
  }
}

export function blankDraft(color: string): Draft {
  return {
    name: '',
    description: '',
    icon: '💪',
    color,
    // A new activity is a habit card with a goal on, defaulting to Once a day (a check-off,
    // every day) — the `once` shape, which most habits are. Any of the three can be changed
    // alone.
    measure: 'count',
    display: 'habit',
    hasGoal: true,
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
  display?: DisplayMode
  targetAmount?: number
  targetPeriod?: Period
}): Draft {
  const hasGoal = activity.targetAmount !== undefined
  return {
    name: activity.name,
    description: activity.description ?? '',
    icon: activity.icon ?? '💪',
    color: activity.color,
    measure: activity.measure,
    display: displayMode(activity),
    hasGoal,
    // Without a goal there is nothing stored to show; seed the fields a re-enabled goal would
    // start from (Once a day, or its duration equivalent) rather than leave them blank.
    targetAmount: hasGoal
      ? String(activity.measure === 'duration' ? activity.targetAmount! / HOUR : activity.targetAmount)
      : '1',
    targetPeriod: hasGoal ? (activity.targetPeriod ?? 'day') : 'day',
  }
}

/** The draft as the data layer wants it, hours converted back to milliseconds. */
export function toInput(draft: Draft, id?: string): ActivityInput {
  const amount =
    draft.hasGoal && draft.targetAmount.trim() !== '' ? Number(draft.targetAmount) : undefined
  // With a goal, the shape already set the scored axis. Without one, there is no separate axis
  // to store: it follows the card, so a Timer sums time and a Habit counts days.
  const measure = draft.hasGoal ? draft.measure : draft.display === 'timer' ? 'duration' : 'count'
  return {
    id,
    name: draft.name,
    description: draft.description,
    icon: draft.icon,
    color: draft.color,
    measure,
    display: draft.display,
    targetAmount: amount === undefined ? undefined : measure === 'duration' ? amount * HOUR : amount,
    targetPeriod: amount === undefined ? undefined : draft.targetPeriod,
  }
}

