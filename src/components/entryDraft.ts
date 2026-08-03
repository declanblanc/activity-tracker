/**
 * The shape an entry takes while it is being typed, and the two conversions either side
 * of it.
 *
 * Separate from `EntryForm` so that both screens which open the form can build a draft
 * without importing a component — and so the form file exports only a component, which
 * is what keeps fast refresh working.
 */
import { isOpen, type Entry } from '../data/types.ts'
import { fromDateTimeInput, toDateTimeInput } from '../lib/time.ts'

/** The form's own shape: every field a string, because that is what inputs hold. */
export type Draft = {
  id?: string
  activityId: string
  start: string
  /** Empty means "no end", which only an entry that is already open may mean. */
  end: string
  note: string
  /** Whether the edited entry is running, which is what makes an empty end legal. */
  wasOpen: boolean
}

/** A new entry defaults to the hour just gone — the shape a forgotten toggle has. */
export const blankDraft = (now: number): Draft => ({
  activityId: '',
  start: toDateTimeInput(now - 60 * 60 * 1000),
  end: toDateTimeInput(now),
  note: '',
  wasOpen: false,
})

export const draftFrom = (entry: Entry): Draft => ({
  id: entry.id,
  activityId: entry.activityId,
  start: toDateTimeInput(entry.startedAt),
  end: isOpen(entry) ? '' : toDateTimeInput(entry.endedAt),
  note: entry.note ?? '',
  wasOpen: isOpen(entry),
})

/**
 * An empty end is `null`, the domain value for "still running" — which `saveEntry`
 * accepts only for an entry that is already open, and otherwise reports as a missing
 * end time. A half-typed time reads as `NaN` and is refused the same way.
 */
export function toInput(draft: Draft) {
  return {
    id: draft.id,
    activityId: draft.activityId,
    startedAt: fromDateTimeInput(draft.start),
    endedAt: draft.end.trim() === '' ? null : fromDateTimeInput(draft.end),
    note: draft.note,
  }
}
