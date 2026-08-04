import { useState, type ReactNode } from 'react'
import type { Period } from '../data/types.ts'
import { ICONS, PALETTE } from '../lib/palette.ts'
import type { Draft } from './activityDraft.ts'
import Button from './ui/Button.tsx'

const PERIODS: Period[] = ['day', 'week', 'month']

const FIELD = 'mt-1 w-full rounded-lg bg-raised px-3 py-2 text-ink focus-ring'

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
  const bothAxes = draft.showCheckoff && draft.showTimer

  /**
   * Turn an axis on or off, keeping the two invariants the save path also enforces: at least one
   * axis stays on, and the lead (`measure`) stays visible. Hiding the lead moves it to the other
   * axis and drops the goal, whose unit no longer applies.
   */
  const setAxis = (axis: 'checkoff' | 'timer', on: boolean) =>
    setDraft((current) => {
      const showCheckoff = axis === 'checkoff' ? on : current.showCheckoff
      const showTimer = axis === 'timer' ? on : current.showTimer
      if (!showCheckoff && !showTimer) return current

      let { measure, targetAmount } = current
      if (measure === 'count' && !showCheckoff) [measure, targetAmount] = ['duration', '']
      if (measure === 'duration' && !showTimer) [measure, targetAmount] = ['count', '']
      return { ...current, showCheckoff, showTimer, measure, targetAmount }
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
      {/* Both axes come first because the goal below is in whichever leads. Both default on; the
          last one on cannot be turned off. */}
      <fieldset>
        <legend className="text-sm font-medium text-ink">How do you track it?</legend>
        <div className="mt-2 flex flex-col gap-2">
          <AxisToggle
            label="Check it off each day"
            hint="One tap a day. Good for habits — stretch, read, take the pills."
            checked={draft.showCheckoff}
            // Off would leave nothing on, so the sole remaining axis is locked.
            locked={draft.showCheckoff && !draft.showTimer}
            onChange={(on) => setAxis('checkoff', on)}
          />
          <AxisToggle
            label="Track time with a timer"
            hint="Start and stop a timer. Good for anything you want the hours for."
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
        <legend className="text-sm font-medium text-ink">
          Goal <span className="font-normal text-ink-muted">(optional)</span>
        </legend>
        <div className="mt-1 flex items-center gap-2">
          <input
            value={draft.targetAmount}
            onChange={(event) => set('targetAmount', event.target.value)}
            type="number"
            // A count is a whole number of days; a duration is typed in hours and quarter
            // hours, which is the granularity anyone actually sets a goal at.
            min={counted ? 1 : 0}
            step={counted ? 1 : 0.25}
            inputMode={counted ? 'numeric' : 'decimal'}
            aria-label={counted ? 'Times per period' : 'Hours per period'}
            className={`${FIELD} mt-0 w-20`}
          />
          {/* With both axes shown the goal could be about either, so its unit becomes a select
              that doubles as the choice of which axis leads. With one axis it is fixed, and reads
              as the bare "per" the check-off wording was pared down to. `shrink-0` and no
              wrapping: without them the unit broke onto two lines and squeezed the period select
              down to its chevron. */}
          {bothAxes ? (
            <>
              <select
                value={counted ? 'days' : 'hours'}
                onChange={(event) => set('measure', event.target.value === 'days' ? 'count' : 'duration')}
                aria-label="Goal unit"
                className={`${FIELD} mt-0 w-20`}
              >
                <option value="days">days</option>
                <option value="hours">hours</option>
              </select>
              <span className="shrink-0 text-sm text-ink-muted">per</span>
            </>
          ) : (
            <span className="shrink-0 text-sm whitespace-nowrap text-ink-muted">
              {counted ? 'per' : 'hours per'}
            </span>
          )}
          <select
            value={draft.targetPeriod}
            onChange={(event) => set('targetPeriod', event.target.value as Period)}
            aria-label="Goal period"
            className={`${FIELD} mt-0 min-w-24 flex-1`}
          >
            {PERIODS.map((period) => (
              <option key={period} value={period}>
                {period}
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
  if (draft.targetAmount.trim() === '') {
    return draft.measure === 'count'
      ? 'No goal: days still fill in, but there is nothing to streak against.'
      : 'No goal: time is still tracked, with nothing to measure it against.'
  }
  if (draft.targetPeriod === 'day') return 'Streak counts consecutive days.'
  return `Streak counts consecutive ${draft.targetPeriod}s that hit the goal.`
}
