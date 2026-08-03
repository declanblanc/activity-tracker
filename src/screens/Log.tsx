import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Plus, ScrollText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import Button from '../components/ui/Button.tsx'
import EmptyState from '../components/ui/EmptyState.tsx'
import PeriodStepper from '../components/ui/PeriodStepper.tsx'
import EntryForm from '../components/EntryForm.tsx'
import { blankDraft, draftFrom, type Draft } from '../components/entryDraft.ts'
import { getActivities } from '../data/activities.ts'
import { getEntriesInRange, startActivity } from '../data/entries.ts'
import { getPref, setActivityStamp } from '../data/prefs.ts'
import { isOpen, type Activity, type Entry } from '../data/types.ts'
import { trackedWallClock } from '../lib/accounting/totals.ts'
import { formatDuration, formatTime } from '../lib/format.ts'
import { dayWindow, weekWindow, type TimeWindow } from '../lib/time.ts'
import { useNow } from '../lib/useNow.ts'

/**
 * The history: every entry of one week, newest day first, grouped under the day it
 * belongs to.
 *
 * History is kept forever, so the Log reads **one week at a time** rather than the
 * whole table — older entries are reached by stepping the window back, which keeps the
 * read bounded however many years accumulate.
 *
 * Newest first because the entry you want is almost always the one you just made, and it
 * used to be at the bottom of the scroll. Grouped because the day used to be repeated on
 * every row — four times over for a normal Sunday — and a heading says it once and can
 * carry the day's total besides.
 *
 * It is also where the record gets corrected: every row opens the same form that adds a
 * forgotten entry by hand, and the row that ends a stopped block offers to resume it —
 * the one Tracker mistake no amount of editing entries can undo, because what a stop
 * ends is the block, which no entry records.
 */
export default function Log() {
  const now = useNow(30_000)
  const [anchor, setAnchor] = useState(() => Date.now())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [resumable, setResumable] = useState(() => getPref('resumableBlockStartedAt'))
  const week = weekWindow(anchor)
  const entries = useLiveQuery(() => getEntriesInRange(week.start, week.end), [week.start])
  // Archived and deleted activities included: an old entry may point at either, and it
  // still has to be readable and correctable.
  const activities = useLiveQuery(() => getActivities(true), [])

  if (!entries || !activities) return null

  // Entries belong to timed activities only, so this screen is about them. A check-off has no
  // interval to draw or list; its history is the grid on the Activities screen.
  const timed = activities.filter((activity) => activity.measure === 'duration')
  // Archived ones count: their recorded stretches are still history this screen should list, and
  // the alternative message would tell an owner that nothing of theirs is timed when something is.
  const anyTimed = timed.length > 0

  const byId = new Map(activities.map((activity) => [activity.id, activity]))
  // Entries arrive oldest first, so the last write per activity wins. A stopped block has
  // nothing recorded after it — starting again would have cleared the mark — so within
  // this week its final entry is the activity's latest, and the only row a resume belongs
  // on.
  const latestByActivity = new Map(entries.map((entry) => [entry.activityId, entry.id]))
  // Grouped into a *new* structure rather than by sorting `entries`: the resume mark above
  // depends on Dexie's oldest-first order, and reversing the array in place would silently
  // move the mark to the week's first entry instead of its last.
  const days = groupByDay(entries)

  /**
   * Take back the stop that ended this block: restore where it began, and open a stretch
   * to carry it on.
   *
   * The new stretch starts now rather than at the stop, which leaves a gap for however
   * long the mistake went unnoticed. That is the honest direction to be wrong in — the
   * alternative invents tracked time — and the gap is an entry away from being fixed on
   * this very screen.
   */
  const resume = async (activityId: string) => {
    const blockStart = resumable[activityId]
    await startActivity(activityId)
    setActivityStamp('blockStartedAt', activityId, blockStart)
    setResumable(setActivityStamp('resumableBlockStartedAt', activityId, undefined))
  }

  return (
    // A dense list of one-line rows wants the narrowest measure in the app; stretched to
    // a monitor's width the name and the duration end up a foot apart.
    <section className="screen-pad mx-auto w-full max-w-2xl">
      <header className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-ink">Log</h1>
        <Button variant="primary" className="ml-auto" onClick={() => setDraft(blankDraft(now))}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </header>

      <PeriodStepper
        className="mt-2"
        label={weekLabel(week)}
        previousLabel="Previous week"
        nextLabel="Next week"
        onPrevious={() => setAnchor(week.start - 1)}
        // Not past the week the clock is in: nothing is recorded ahead of now.
        onNext={week.end <= now ? () => setAnchor(week.end) : undefined}
      />

      {/* Only the new entry belongs up here. An edit belongs under the row it corrects —
          see the row's own form below — because a form floating at the top of a week of
          rows never said which of them it was about. */}
      {draft && !draft.id && (
        <EntryForm
          className="mt-4"
          draft={draft}
          activities={timed}
          onChange={setDraft}
          onClose={() => setDraft(null)}
        />
      )}

      {entries.length === 0 && !draft && (
        <EmptyState
          icon={<ScrollText className="size-8" />}
          action={
            anyTimed ? (
              <Button variant="primary" onClick={() => setDraft(blankDraft(now))}>
                Add an entry
              </Button>
            ) : (
              <Link
                to="/"
                className="focus-ring inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
              >
                Go to Activities
              </Link>
            )
          }
        >
          {/* As on Today: an owner with nothing timed has no entries to list, and the grid on
              the Activities screen is where their check-offs already live. */}
          {anyTimed
            ? 'Nothing tracked this week. Step back to an earlier week, or write down a stretch the timers missed.'
            : 'The log lists timed stretches. None of your activities are timed — the ones you check off show their history on the Activities grid.'}
        </EmptyState>
      )}

      {days.map(({ dayStart, entries: ofDay }) => (
        <section key={dayStart} className="mt-4">
          {/* Sticky, so the day you are reading stays named while you scroll through it.
              The total is the tracked union over that day computed from the whole week's
              entries, not a sum of the rows: an entry that ran 23:00→07:00 belongs partly
              to each of two days, and rows that overlapped would double-count. */}
          <h2 className="sticky top-0 z-10 -mx-1 flex items-baseline gap-2 bg-canvas/95 px-1 py-2 backdrop-blur">
            <span className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">
              {dayLabel(dayStart)}
            </span>
            <span className="text-2xs text-ink-muted tabular-nums">
              {formatDuration(trackedWallClock(entries, dayWindow(dayStart), now))} tracked
            </span>
          </h2>

          <ul className="flex flex-col gap-1.5">
            {ofDay.map((entry) => {
              const activity = byId.get(entry.activityId)
              // An archived or deleted activity is not offered: archiving stops its timer
              // on purpose, and neither belongs back on the Tracker.
              const canResume =
                activity !== undefined &&
                !activity.archived &&
                resumable[entry.activityId] !== undefined &&
                latestByActivity.get(entry.activityId) === entry.id

              return (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  activity={activity}
                  now={now}
                  onEdit={() =>
                    // A second tap on the open row closes it again, the way the row's own
                    // chevron says it should.
                    setDraft(draft?.id === entry.id ? null : draftFrom(entry))
                  }
                  onResume={canResume ? () => void resume(entry.activityId) : undefined}
                  form={
                    draft?.id === entry.id ? (
                      <EntryForm
                        draft={draft}
                        activities={timed}
                        onChange={setDraft}
                        onClose={() => setDraft(null)}
                      />
                    ) : undefined
                  }
                />
              )
            })}
          </ul>
        </section>
      ))}
    </section>
  )
}

function EntryRow({
  entry,
  activity,
  now,
  onEdit,
  onResume,
  form,
}: {
  entry: Entry
  activity?: Activity
  now: number
  onEdit: () => void
  /** Present only on the row that ends a block a stop can still be taken back from. */
  onResume?: () => void
  /** This row's edit form, when it is the row being edited. */
  form?: ReactNode
}) {
  const running = isOpen(entry)
  const editing = form !== undefined

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-stretch gap-2">
        {/* Nearly the whole row is the tap target: on a phone a row of small action
            buttons is harder to hit than the row itself, and editing is what almost every
            row does. The chevron is there because nothing else said so; it turns down when
            the form is open beneath. */}
        <button
          type="button"
          onClick={onEdit}
          aria-expanded={editing}
          className={`focus-ring panel group flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-raised ${
            editing ? 'bg-raised' : ''
          }`}
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: activity?.color ?? 'var(--color-orphan)' }}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {activity?.name ?? 'Deleted activity'}
              </span>
              <span className="text-xs text-ink-muted tabular-nums">
                {formatTime(entry.startedAt)} –{' '}
                {running ? <span className="text-accent-ink">now</span> : formatTime(entry.endedAt)}
              </span>
            </span>
            {entry.note && <span className="mt-0.5 block truncate text-xs text-ink-soft">{entry.note}</span>}
          </span>
          <span className="shrink-0 text-sm text-ink-soft tabular-nums">
            {formatDuration((running ? now : entry.endedAt) - entry.startedAt)}
          </span>
          <ChevronRight
            aria-hidden
            className={`size-4 shrink-0 text-ink-subtle transition-transform group-hover:text-ink-muted ${
              editing ? 'rotate-90' : ''
            }`}
          />
        </button>

        {/* A running entry is already going; there is nothing to resume. */}
        {onResume && !running && (
          <Button variant="quiet" className="shrink-0 px-3 text-xs" onClick={onResume}>
            Resume
          </Button>
        )}
      </div>

      {form}
    </li>
  )
}

/** `Jul 26 – Aug 1`. The end is exclusive, so the label names the last day inside it. */
function weekLabel(week: TimeWindow): string {
  const day = (at: number) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${day(week.start)} – ${day(week.end - 1)}`
}

const dayLabel = (at: number) =>
  new Date(at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

/**
 * The week's entries as days, newest first, each day's entries newest first within it.
 *
 * Keyed on the *local* day an entry started, via `dayWindow`, so an entry that began at
 * 23:00 files under the day it began rather than the one it ended in. That is the same
 * choice the day heading's own total does not make — the total clips across midnight and
 * counts each day's real share — and the two differ on purpose: a row belongs somewhere
 * definite, while tracked time genuinely spans both days.
 */
function groupByDay(entries: Entry[]): { dayStart: number; entries: Entry[] }[] {
  const byDay = new Map<number, Entry[]>()

  for (const entry of entries) {
    const dayStart = dayWindow(entry.startedAt).start
    const ofDay = byDay.get(dayStart)
    if (ofDay) ofDay.push(entry)
    else byDay.set(dayStart, [entry])
  }

  return [...byDay]
    .sort(([a], [b]) => b - a)
    .map(([dayStart, ofDay]) => ({ dayStart, entries: [...ofDay].reverse() }))
}

