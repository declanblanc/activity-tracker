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
  /** The goal axis: the unit the goal is in, and which axis the sheet leads with. */
  measure: Measure
  /** Which axes the card shows. At least one is always on. See `Activity.showCheckoff`. */
  showCheckoff: boolean
  showTimer: boolean
  /** As typed: hours for a duration, days for a count. Always a goal — see `GOAL_SHAPES`. */
  targetAmount: string
  targetPeriod: Period
}

/**
 * The six goal shapes the form offers, and nothing else. `days` × `day` is missing on purpose:
 * a day can only be checked off once, so the sole days-per-day goal is "once", which is its own
 * named shape with a fixed amount. Every other combination of a unit and a period is a real goal.
 *
 * The shape encodes a `(measure, period)` pair — `measure` picks the unit (days vs hours) — so
 * this list is the single source of which pairs are sayable. There is no "no goal": every
 * activity has one, defaulting to `once`.
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
    // A new activity's card shows both axes; either can be turned off later. Its goal defaults to
    // Once a day (a check-off, every day) — the `once` shape, which most habits are.
    measure: 'count',
    showCheckoff: true,
    showTimer: true,
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
  showCheckoff?: boolean
  showTimer?: boolean
  targetAmount?: number
  targetPeriod?: Period
}): Draft {
  return {
    name: activity.name,
    description: activity.description ?? '',
    icon: activity.icon ?? '💪',
    color: activity.color,
    // Fall back to the measure for a record from before the flags existed, so editing an old
    // activity shows exactly the single card axis it already had, with the other off.
    showCheckoff: activity.showCheckoff ?? activity.measure === 'count',
    showTimer: activity.showTimer ?? activity.measure === 'duration',
    // A goal-less record predates the every-activity-has-a-goal rule; editing it adopts the
    // default, Once a day, the same as a new activity. Otherwise show the stored goal as typed.
    ...(activity.targetAmount === undefined
      ? { measure: 'count' as Measure, targetAmount: '1', targetPeriod: 'day' as Period }
      : {
          measure: activity.measure,
          targetAmount: String(
            activity.measure === 'duration' ? activity.targetAmount / HOUR : activity.targetAmount,
          ),
          targetPeriod: activity.targetPeriod ?? 'day',
        }),
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
    showCheckoff: draft.showCheckoff,
    showTimer: draft.showTimer,
    targetAmount:
      amount === undefined ? undefined : draft.measure === 'duration' ? amount * HOUR : amount,
    targetPeriod: amount === undefined ? undefined : draft.targetPeriod,
  }
}

