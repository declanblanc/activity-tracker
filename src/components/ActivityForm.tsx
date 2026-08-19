import { useState, type ReactNode } from 'react'
import type { DisplayMode, Measure } from '../data/types.ts'
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
 * One form for creating and editing, in either display mode.
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

  return (
    <form
      className="w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-surface p-5 shadow-xl"
      onSubmit={(event) => {
        event.preventDefault()
        if (!draft.name.trim()) return
        onSubmit({ ...draft, name: draft.name.trim(), description: draft.description.trim() })
      }}
    >
      {/* Display only: which card this activity gets on the Activities list. Radios rather than
          checkboxes because the list draws one card — there is no "both" for it to draw. The
          activity's own page shows both axes either way, and the goal below is independent. */}
      <fieldset>
        <legend className="text-sm font-medium text-ink">Display mode</legend>
        <p className="mt-0.5 text-xs text-ink-muted">
          How the card looks on the Activities list. Its own page always shows both.
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <ModeOption
            label="Habit"
            hint="A filled square for each day you check it off."
            mode="habit"
            selected={draft.display}
            onSelect={(mode) => set('display', mode)}
          />
          <ModeOption
            label="Timer"
            hint="Start and stop a timer, with a running total."
            mode="timer"
            selected={draft.display}
            onSelect={(mode) => set('display', mode)}
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
        <div className="flex items-center justify-between">
          <legend className="text-sm font-medium text-ink">Goal</legend>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Set a goal
            <input
              type="checkbox"
              checked={draft.hasGoal}
              onChange={(event) => set('hasGoal', event.target.checked)}
              className="focus-ring size-4 accent-accent"
            />
          </label>
        </div>
        {draft.hasGoal ? (
          <>
            {/* An amount and a shape, together the whole goal. The amount hides for "Once a
                day", whose count is fixed at one. Days-per-day is not in the list — see
                `GOAL_SHAPES`. */}
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
          </>
        ) : (
          <>
            {/* No goal means no shape picker, but the scored axis is still a real choice — it
                is what the streak, the "total" and the sheet's lead layout are about even
                without a target to reach. */}
            <div className="mt-2 flex flex-col gap-2">
              <MeasureOption
                label="Check off days"
                hint="Streak and total count the days you check it off."
                measure="count"
                selected={draft.measure}
                onSelect={(measure) => set('measure', measure)}
              />
              <MeasureOption
                label="Track time"
                hint="Streak and total count the time you log."
                measure="duration"
                selected={draft.measure}
                onSelect={(measure) => set('measure', measure)}
              />
            </div>
            <p className="mt-1 text-xs text-ink-muted">Just tracked, with nothing to hit.</p>
          </>
        )}
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

/** One display mode, as a radio with a hint. */
function ModeOption({
  label,
  hint,
  mode,
  selected,
  onSelect,
}: {
  label: string
  hint: ReactNode
  mode: DisplayMode
  selected: DisplayMode
  onSelect: (mode: DisplayMode) => void
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="radio"
        name="display-mode"
        value={mode}
        checked={selected === mode}
        onChange={() => onSelect(mode)}
        className="focus-ring mt-0.5 size-5 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  )
}

/**
 * One scored axis, as a radio with a hint. Only shown once a goal is off — with one on, the
 * shape select already says the axis through its unit ("days" vs "hours").
 */
function MeasureOption({
  label,
  hint,
  measure,
  selected,
  onSelect,
}: {
  label: string
  hint: ReactNode
  measure: Measure
  selected: Measure
  onSelect: (measure: Measure) => void
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="radio"
        name="measure"
        value={measure}
        checked={selected === measure}
        onChange={() => onSelect(measure)}
        className="focus-ring mt-0.5 size-5 shrink-0 accent-accent"
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
