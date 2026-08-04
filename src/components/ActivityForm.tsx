import { useState, type ReactNode } from 'react'
import { ICONS, PALETTE } from '../lib/palette.ts'
import { GOAL_SHAPES, applyGoalShape, goalShapeOf, type Draft, type GoalShape } from './activityDraft.ts'
import Button from './ui/Button.tsx'

const FIELD = 'mt-1 w-full rounded-lg bg-raised px-3 py-2 text-ink focus-ring'

/**
 * The largest count goal each period can hold, mirrored from `MAX_COUNT_TARGET` in
 * `data/activities.ts` — which is the authority that rejects the rest. Kept here so the form
 * does not import the data layer (and with it Dexie). No `day`: that period is "Once a day",
 * which has no amount to cap.
 */
const MAX_DAYS: Record<'week' | 'month', number> = { week: 7, month: 31 }

/**
 * One form for creating and editing, and for any mix of the two axes.
 *
 * In a dialog rather than inline under a row: it is longer than either form it replaces, and the
 * dialog is also the scroll container, so a tall form on a short screen produces one scrollbar
 * rather than nesting a second inside the page.
 */
export default function ActivityForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft
  submitLabel: string
  onSubmit: (draft: Draft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const counted = draft.measure === 'count'
  const shape = goalShapeOf(draft)
  const onceADay = shape === 'once'

  /**
   * Turn a card axis on or off. Display only — which axes the activity's card shows on the list.
   * The goal and the sheet are untouched by this. The one invariant the save path also enforces:
   * at least one axis stays on, so the last one on is locked.
   */
  const setAxis = (axis: 'checkoff' | 'timer', on: boolean) =>
    setDraft((current) => {
      const showCheckoff = axis === 'checkoff' ? on : current.showCheckoff
      const showTimer = axis === 'timer' ? on : current.showTimer
      if (!showCheckoff && !showTimer) return current
      return { ...current, showCheckoff, showTimer }
    })

  return (
    <form
      className="w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-surface p-5 shadow-xl"
      onSubmit={(event) => {
        event.preventDefault()
        if (!draft.name.trim()) return
        onSubmit({ ...draft, name: draft.name.trim(), description: draft.description.trim() })
      }}
    >
      {/* Display only: which axes the card on the activity list shows. The activity's own page
          always shows both, and the goal below is independent of this. Both default on; the last
          one on cannot be turned off. */}
      <fieldset>
        <legend className="text-sm font-medium text-ink">Show on the activity list</legend>
        <p className="mt-0.5 text-xs text-ink-muted">
          Its own page always shows both — this is just the card.
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <AxisToggle
            label="Heat map"
            hint="A filled square for each day you check it off."
            checked={draft.showCheckoff}
            // Off would leave nothing on, so the sole remaining axis is locked.
            locked={draft.showCheckoff && !draft.showTimer}
            onChange={(on) => setAxis('checkoff', on)}
          />
          <AxisToggle
            label="Timer"
            hint="Start and stop a timer, with a running total."
            checked={draft.showTimer}
            locked={draft.showTimer && !draft.showCheckoff}
            onChange={(on) => setAxis('timer', on)}
          />
        </div>
      </fieldset>

      <label className="mt-4 block text-sm font-medium text-ink" htmlFor="activity-name">
        Name
      </label>
      <input
        id="activity-name"
        value={draft.name}
        onChange={(event) => set('name', event.target.value)}
        // The one field worth blocking submit over; everything else has a sane default.
        required
        maxLength={60}
        autoFocus
        className={FIELD}
      />

      <label className="mt-4 block text-sm font-medium text-ink" htmlFor="activity-description">
        Description <span className="font-normal text-ink-muted">(optional)</span>
      </label>
      <input
        id="activity-description"
        value={draft.description}
        onChange={(event) => set('description', event.target.value)}
        maxLength={120}
        className={FIELD}
      />

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-ink">Goal</legend>
        {/* An amount and a shape, together the whole goal. The amount hides for "Once a day",
            whose count is fixed at one. Days-per-day is not in the list — see `GOAL_SHAPES`. */}
        <div className="mt-1 flex items-center gap-2">
          {!onceADay && (
            <input
              value={draft.targetAmount}
              onChange={(event) => set('targetAmount', event.target.value)}
              type="number"
              // A count is a whole number of days, capped at what the period can hold; a
              // duration is typed in hours and quarter hours, uncapped.
              required
              min={counted ? 1 : 0.25}
              step={counted ? 1 : 0.25}
              max={counted ? MAX_DAYS[draft.targetPeriod as 'week' | 'month'] : undefined}
              inputMode={counted ? 'numeric' : 'decimal'}
              aria-label={counted ? 'Days per period' : 'Hours per period'}
              className={`${FIELD} mt-0 w-20`}
            />
          )}
          <select
            value={shape}
            onChange={(event) =>
              setDraft((current) => applyGoalShape(current, event.target.value as GoalShape))
            }
            aria-label="Goal"
            className={`${FIELD} mt-0 min-w-40 flex-1`}
          >
            {GOAL_SHAPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-xs text-ink-muted">{goalHint(draft)}</p>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-ink">Icon</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ICONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => set('icon', option)}
              aria-pressed={draft.icon === option}
              aria-label={option}
              className="focus-ring size-9 rounded-lg text-lg transition-transform active:scale-90 aria-pressed:ring-2 aria-pressed:ring-ink-muted"
            >
              {option}
            </button>
          ))}
        </div>
        <input
          value={draft.icon}
          onChange={(event) => set('icon', event.target.value)}
          // Any emoji, not just the presets — two chars covers the surrogate pairs that make
          // up most of them without becoming a text field.
          maxLength={2}
          aria-label="Or type any emoji"
          placeholder="Or type any emoji"
          className={`${FIELD} mt-2 text-sm`}
        />
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-ink">Colour</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {PALETTE.map((option) => (
            <button
              key={option.hex}
              type="button"
              onClick={() => set('color', option.hex)}
              style={{ backgroundColor: option.hex }}
              // The name, not the hex: a picker announcing "#6ee7b7" has not been labelled.
              aria-label={option.name}
              aria-pressed={draft.color === option.hex}
              className="focus-ring size-8 rounded-full transition-transform active:scale-90 aria-pressed:ring-2 aria-pressed:ring-ink aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface"
            />
          ))}
        </div>
      </fieldset>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

/**
 * One axis, as a checkbox with a hint. `locked` is the sole-remaining-axis case: it stays checked
 * and disabled, because turning it off would leave the activity tracking nothing.
 */
function AxisToggle({
  label,
  hint,
  checked,
  locked,
  onChange,
}: {
  label: string
  hint: ReactNode
  checked: boolean
  locked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className={`flex items-start gap-3 ${locked ? 'opacity-70' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(event) => onChange(event.target.checked)}
        className="focus-ring mt-0.5 size-5 shrink-0 rounded accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  )
}

/** What the chosen goal will actually do, in one line. */
function goalHint(draft: Draft): string {
  if (draft.targetPeriod === 'day') {
    return draft.measure === 'count'
      ? 'Streak counts consecutive days you check it off.'
      : 'Streak counts consecutive days you hit the hours.'
  }
  return `Streak counts consecutive ${draft.targetPeriod}s that hit the goal.`
}
