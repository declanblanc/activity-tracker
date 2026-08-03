import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import Button from './ui/Button.tsx'
import { getActivities } from '../data/activities.ts'
import { getOpenEntries, stopActivity } from '../data/entries.ts'
import { getPref, setPref } from '../data/prefs.ts'
import type { Entry } from '../data/types.ts'
import { formatDuration } from '../lib/format.ts'
import { fromDateTimeInput, toDateTimeInput } from '../lib/time.ts'

/**
 * How long an entry may stay open before it is assumed to be a toggle left on by
 * mistake. 14h clears a normal night of sleep and a long workday without firing, while
 * still catching an overnight mistake. Tune after living with the app for a week.
 */
const FORGOTTEN_AFTER = 14 * 60 * 60 * 1000

/** How long "keep it running" silences the prompt for. */
const SNOOZE_FOR = 6 * 60 * 60 * 1000

/**
 * One prompt listing every entry that has been open longer than `FORGOTTEN_AFTER`,
 * shown when the app is opened.
 *
 * The threshold is measured against the moment the app opened, not against a live
 * clock: a prompt that appeared on its own halfway through a session would interrupt
 * the very tracking it is asking about. Crossing 14h is noticed the next time the app
 * is opened, which is exactly when the user can act on it.
 *
 * All the stale entries share one dialog. One dialog per entry would mean dismissing
 * four in a row after a weekend away.
 */
export default function ForgottenPrompt() {
  const openedAt = useRef(Date.now()).current
  const openEntries = useLiveQuery(() => getOpenEntries(), [])
  const activities = useLiveQuery(() => getActivities(true), [])
  const [snoozedUntil, setSnoozedUntil] = useState(() => getPref('forgottenPromptSnoozedUntil'))

  if (!openEntries || !activities || snoozedUntil > openedAt) return null

  const stale = openEntries.filter((entry) => openedAt - entry.startedAt > FORGOTTEN_AFTER)
  if (stale.length === 0) return null

  const nameOf = (entry: Entry) =>
    activities.find((activity) => activity.id === entry.activityId)?.name ?? 'An activity'

  const snooze = () => {
    const until = Date.now() + SNOOZE_FOR
    setPref('forgottenPromptSnoozedUntil', until)
    setSnoozedUntil(until)
  }

  return (
    // The platform's own dialog, rather than a div wearing `role="dialog"`. `showModal()`
    // brings the focus trap, the initial focus, Escape-to-close, the inert background and
    // the ::backdrop — the four things the hand-rolled version was missing — in less code
    // than any one of them would have taken to write.
    //
    // Escape closes without snoozing, which is the right default: the prompt asks a
    // question about the timers, and dismissing it is not an answer. It returns the next
    // time the app opens.
    <dialog
      ref={showModal}
      // The dialog itself is the full-viewport frame — transparent, with the UA's own
      // sizing overridden — so the sheet inside it can sit against the bottom edge on a
      // phone and centred on a desktop, the same two placements as before.
      className="h-full max-h-none w-full max-w-none bg-transparent p-4 backdrop:bg-canvas/80"
    >
      {/* Bottom sheet on a phone, where the thumb is; centred on a desktop, where the eye
          is and the pointer travels freely. */}
      <div className="flex h-full items-end md:items-center md:justify-center">
        <div className="panel w-full rounded-2xl p-4 md:max-w-md">
          <h2 className="text-lg font-semibold text-ink">Still running</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {stale.length === 1 ? 'This timer has' : 'These timers have'} been on for over 14
            hours. Did you forget to turn {stale.length === 1 ? 'it' : 'them'} off?
          </p>

          <ul className="mt-4 flex flex-col gap-3">
            {stale.map((entry) => (
              <StaleEntry key={entry.id} entry={entry} name={nameOf(entry)} openedAt={openedAt} />
            ))}
          </ul>

          <Button className="mt-4 w-full" onClick={snooze}>
            Keep {stale.length === 1 ? 'it' : 'them all'} running
          </Button>
        </div>
      </div>
    </dialog>
  )
}

/**
 * Open the dialog modally the moment it mounts.
 *
 * A ref callback rather than an effect: the element does not exist until the two live
 * queries have resolved and found something stale, so there is no mount for an effect to
 * fire on at the time it would need to. Calling `showModal` on an already-open dialog
 * throws, hence the guard.
 */
function showModal(dialog: HTMLDialogElement | null) {
  if (dialog && !dialog.open) dialog.showModal()
}

/** One stale entry, with an editable end time so a guessed stop time can be corrected. */
function StaleEntry({
  entry,
  name,
  openedAt,
}: {
  entry: Entry
  name: string
  openedAt: number
}) {
  const [endsAt, setEndsAt] = useState(() => toDateTimeInput(openedAt))
  const [error, setError] = useState<string | null>(null)

  const stop = () => {
    const at = fromDateTimeInput(endsAt)
    // The only place in the app where a human picks an end time directly, so it is the
    // boundary that has to reject one that lands before the entry began. NaN from a
    // cleared field fails this comparison too.
    if (!(at > entry.startedAt)) {
      setError('Pick a time after the timer started.')
      return
    }
    void stopActivity(entry.activityId, at)
  }

  return (
    <li className="rounded-xl bg-canvas p-3">
      <p className="font-medium text-ink">{name}</p>
      <p className="text-xs text-ink-muted">
        Running {formatDuration(openedAt - entry.startedAt)}, since{' '}
        {new Date(entry.startedAt).toLocaleString([], {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>

      <div className="mt-2 flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
          Stopped at
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            className="rounded-lg bg-surface px-2 py-2 text-sm text-ink"
          />
        </label>
        <Button variant="primary" className="mt-auto" onClick={stop}>
          Stop
        </Button>
      </div>

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </li>
  )
}
