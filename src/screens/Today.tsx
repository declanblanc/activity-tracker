import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, Plus } from 'lucide-react'
import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import EntrySheet from '../components/EntrySheet.tsx'
import { blankDraft, draftFrom, type Draft } from '../components/entryDraft.ts'
import Button from '../components/ui/Button.tsx'
import EmptyState from '../components/ui/EmptyState.tsx'
import { Modal } from '../components/ui/Modal.tsx'
import { getActivities } from '../data/activities.ts'
import { getEntriesInRange } from '../data/entries.ts'
import { isOpen, type Activity, type Entry } from '../data/types.ts'
import { perActivityTotals } from '../lib/accounting/totals.ts'
import { formatDuration, formatTime } from '../lib/format.ts'
import { assignLanes, laneSpans } from '../lib/lanes.ts'
import { dayWindow, toDateTimeInput, type TimeWindow } from '../lib/time.ts'
import { useNow } from '../lib/useNow.ts'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/** Below this a bar has no room for its own name, and two clipped words read as noise. */
const LABEL_MIN_HEIGHT = 26

/**
 * The timeline never shrinks past this, even if the chips and header leave it less.
 *
 * ponytail: a floor rather than a layout that cannot overflow. Below about this height the hour
 * grid stops being readable at any label density, so scrolling is the better failure — and it takes
 * a short landscape phone to reach it. Upgrade path is collapsing the chips into a single summary.
 */
const MIN_TIMELINE_HEIGHT = 260

/** A click on empty space lands on the quarter hour, which is how people describe when things ran. */
const SNAP = 15 * MINUTE

/**
 * Today as a vertical timeline: time runs down, and simultaneous activities sit in side-by-side
 * lanes so none hides another.
 *
 * The whole day is drawn **within the viewport** — the timeline takes whatever height is left over
 * and divides it, rather than claiming a fixed height per hour and being scrolled. A day is a fixed
 * quantity and this is the screen that shows its shape, so having to scroll to see the shape defeated
 * it. The hour labels thin out as the space does; the grid lines go with them.
 *
 * A bar is drawn from the entry's interval *clipped to today* — an entry that started before
 * midnight begins at the top edge rather than off-screen above it, and an open entry ends at the
 * current time and grows as the clock moves. The stored record is never altered by any of that;
 * clipping is a drawing concern.
 *
 * A bar's position is a fraction of the day's own length, not of a hard-coded 24 hours, so the
 * timeline is still correct on the two days a year that are 23 or 25 hours long. That invariant is
 * also why the empty hours are not collapsed: a bar's height would stop meaning duration.
 *
 * Tapping a bar opens it in a sheet, and tapping empty space before now opens a new entry starting
 * there. This is the screen where a mistake is usually spotted — a run that clearly did not last
 * four hours is obvious as a shape long before it is obvious as a row of numbers — so it is the
 * screen that should be able to fix it.
 */
export default function Today() {
  // 30s, not 1s: a bar grows by half a pixel a minute, so a per-second re-render of the whole day
  // would buy nothing visible.
  const now = useNow(30_000)
  const today = dayWindow(now)
  const entries = useLiveQuery(() => getEntriesInRange(today.start, today.end), [today.start])
  const activities = useLiveQuery(() => getActivities(true), [])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [timeline, height] = useMeasuredHeight()

  if (!entries || !activities) return null

  const byId = new Map(activities.map((activity) => [activity.id, activity]))
  // Clip first, then pack: two entries that overlap only outside today must not be pushed into
  // separate lanes for an overlap the screen never shows.
  const bars = entries.map((entry) => ({
    entry,
    activity: byId.get(entry.activityId),
    start: Math.max(entry.startedAt, today.start),
    end: Math.min(isOpen(entry) ? now : entry.endedAt, today.end),
  }))
  const lanes = assignLanes(bars)
  // How many lanes each bar shares its width with, per overlapping cluster rather than per day: one
  // two-lane overlap at 09:00 used to halve every bar until midnight.
  const widths = laneSpans(bars, lanes)

  /** A new entry of an hour, starting where the timeline was tapped. */
  const addAt = (at: number) => {
    const start = Math.floor(at / SNAP) * SNAP
    // An hour, not "up to now": the form is open on top of it, so a length to adjust beats a length
    // that changes depending on how close to now the tap landed.
    setDraft({ ...blankDraft(now), start: toDateTimeInput(start), end: toDateTimeInput(start + HOUR) })
  }

  // No activities at all is the one state with no timeline worth drawing: there is nothing to
  // show and nothing that could be added, since an entry needs an activity to belong to. Every
  // activity can hold one, whichever card it shows on the Activities list.
  if (activities.length === 0) {
    return (
      <Screen now={now}>
        <EmptyState
          icon={<CalendarDays className="size-8" />}
          action={
            <Link
              to="/"
              className="focus-ring inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              Go to Activities
            </Link>
          }
        >
          The timeline draws the stretches you time. Add an activity and its entries show up
          here.
        </EmptyState>
      </Screen>
    )
  }

  return (
    <Screen
      now={now}
      // The keyboard route to what tapping empty space does with a pointer. The overlay below cannot
      // be one: it is a region, not a control, and a screenful of it has no accessible name.
      action={
        <Button onClick={() => addAt(now - HOUR)}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      }
    >
      {/* One scrolling row rather than wrapping: wrapped chips grow the header by a line at a time
          and take the height out of the timeline, which is the thing that must fit. */}
      <ActivityTotals totals={perActivityTotals(entries, today, now)} byId={byId} />

      <div
        ref={timeline}
        className="relative mt-3 min-h-0 flex-1"
        style={{ minHeight: MIN_TIMELINE_HEIGHT }}
      >
        <HourGrid day={today} height={height} />

        {/* Only the part of the day that has happened. Future space is not a target rather than a
            target that silently does nothing, and there is no tracked time to record ahead of now. */}
        <TapToAdd day={today} now={now} onAdd={addAt} />

        {/* One absolutely positioned bar per entry, inset past the hour labels. After the tap region
            in DOM order, so a bar takes the click over the empty space behind it.

            `pointer-events-none` on the container, restored on each bar: the container spans the
            whole day whatever its bars do, so without this it swallows every click meant for the
            empty space behind it. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 left-12">
          {bars.map((bar, index) => (
            <Bar
              key={bar.entry.id}
              {...bar}
              day={today}
              lane={lanes[index]}
              width={widths[index]}
              timelineHeight={height}
              onEdit={() => setDraft(draftFrom(bar.entry))}
            />
          ))}
        </div>

        <NowLine day={today} now={now} />

        {bars.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-sm text-ink-muted">
            Nothing tracked today yet. Start a timer, or tap anywhere above the line to write down a
            stretch.
          </p>
        )}
      </div>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        label={draft?.id ? 'Edit entry' : 'New entry'}
        // The same drawer the activity sheet uses: full-screen on a phone, a right-hand panel from
        // `sm` up. See `EntrySheet`.
        className="m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto sm:mr-0 sm:ml-auto sm:w-[30rem]"
      >
        {draft && (
          <EntrySheet
            draft={draft}
            activities={activities}
            onChange={setDraft}
            onClose={() => setDraft(null)}
          />
        )}
      </Modal>
    </Screen>
  )
}

/**
 * The screen's frame: exactly the height of the viewport, with the timeline taking what the header
 * and the chips leave.
 *
 * `h-full` resolves because `<main>` is a `flex-1` child of a `min-h-dvh` flex container, so its
 * height is definite even though nothing states it in pixels.
 */
function Screen({
  now,
  action,
  children,
}: {
  now: number
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    // Capped narrow: a day is drawn downwards, so extra width only stretches each bar without
    // showing more of anything.
    <section className="screen-pad mx-auto flex h-full w-full max-w-2xl flex-col">
      <header className="flex shrink-0 items-baseline gap-2">
        <h1 className="text-xl font-semibold text-ink">Today</h1>
        <p className="min-w-0 flex-1 truncate text-sm text-ink-muted">
          {new Date(now).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
        {action}
      </header>
      {children}
    </section>
  )
}

/**
 * The timeline's rendered height in pixels, which decides how much detail fits in it.
 *
 * A callback ref rather than an effect over `ref.current`: the timeline does not exist until the live
 * queries resolve, so an effect with an empty dependency list runs on the render that returned
 * `null`, finds nothing to observe, and never runs again — leaving the height at zero, every bar
 * unlabelled and the hour labels at their coarsest. The callback runs when the element actually
 * arrives.
 */
function useMeasuredHeight() {
  const [height, setHeight] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)

  const ref = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!element) return

    setHeight(element.clientHeight)
    observer.current = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.current.observe(element)
  }, [])

  return [ref, height] as const
}

/**
 * What today came to, per activity, longest first.
 *
 * These are per-activity totals, so timers that overlapped each count their time in full and the
 * chips can add up past the hours in a day. No reconciled figure is offered alongside them, because
 * the timeline below *is* the explanation — two bars side by side is what an activity-hour counted
 * twice looks like.
 *
 * Clipped to today like the bars are, so an entry that ran from last night contributes only the part
 * that falls after midnight.
 */
function ActivityTotals({
  totals,
  byId,
}: {
  totals: Map<string, number>
  byId: Map<string, Activity>
}) {
  const rows = [...totals]
    .map(([activityId, total]) => ({ activityId, total, activity: byId.get(activityId) }))
    .sort((a, b) => b.total - a.total)

  if (rows.length === 0) return null

  return (
    <ul className="mt-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
      {rows.map((row) => (
        <li
          key={row.activityId}
          className="flex shrink-0 items-center gap-2 rounded-full bg-surface py-1.5 pr-3 pl-2.5"
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: row.activity?.color ?? 'var(--color-orphan)' }}
          />
          <span className="text-xs font-medium whitespace-nowrap text-ink">
            {row.activity?.name ?? 'Deleted activity'}
          </span>
          <span className="text-xs text-ink-muted tabular-nums">{formatDuration(row.total)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The region of the day that has already happened, as a target for adding a stretch to it.
 *
 * `aria-hidden`, and deliberately not a button: it is a whole screen of surface whose meaning is
 * *where* it was clicked, which no accessible name can express. The header's Add button is the
 * equivalent control, and every existing bar is a real button.
 */
function TapToAdd({
  day,
  now,
  onAdd,
}: {
  day: TimeWindow
  now: number
  onAdd: (at: number) => void
}) {
  const elapsed = (now - day.start) / (day.end - day.start)

  return (
    <div
      aria-hidden
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        // Scaled by `elapsed`, because this element covers only the elapsed part of the day: a
        // fraction of *its* height is that same fraction of the past, not of the whole day. Without
        // it an early-morning tap lands around midday.
        const fraction = ((event.clientY - box.top) / box.height) * elapsed
        onAdd(day.start + fraction * (day.end - day.start))
      }}
      // `cursor-copy` and nothing else. This is one element covering the whole elapsed day, so any
      // hover background lights the entire timeline at once — which reads as the day being selected
      // rather than as a hint about the few pixels under the pointer. The cursor is already the
      // affordance, and it points at exactly the spot that would be used.
      className="absolute top-0 right-0 left-12 cursor-copy"
      style={{ height: `${elapsed * 100}%` }}
    />
  )
}

/**
 * One entry, drawn where it happened and tappable to correct it.
 *
 * The activity's colour arrives as `--activity` and is used as a tint plus a full-strength rail down
 * the leading edge — never as a surface with text on it. The fill used to be the raw colour with
 * white text over it, which for a light pick was around 2.3:1, and the colour is the owner's to
 * choose, so no palette fixes that.
 *
 * A short bar is a small target — a half-hour reads 22px and a five-minute entry hits the 3px floor
 * — which is below the 24px WCAG 2.5.8 asks for. That is not fixable here without the height ceasing
 * to mean duration, which is the screen's whole grammar. It relies instead on that criterion's
 * equivalent-control exception: every entry is also a full-height row in that activity's sheet,
 * opening the same sheet this does.
 */
function Bar({
  entry,
  activity,
  start,
  end,
  day,
  lane,
  width,
  timelineHeight,
  onEdit,
}: {
  entry: Entry
  activity?: Activity
  start: number
  end: number
  day: TimeWindow
  /** Which lane of its cluster this bar sits in. */
  lane: number
  /** How many lanes that cluster needs, and so what fraction of the width to take. */
  width: number
  /** The timeline's pixel height, which is what decides whether a label fits. */
  timelineHeight: number
  onEdit: () => void
}) {
  const length = day.end - day.start
  const fraction = (end - start) / length
  const name = activity?.name ?? 'Deleted activity'

  return (
    <button
      type="button"
      onClick={onEdit}
      // The name and both times, because the bar itself only has room for the name — and on a short
      // bar, not even that.
      aria-label={`Edit ${name}, ${formatTime(start)} to ${isOpen(entry) ? 'now' : formatTime(end)}`}
      style={
        {
          '--activity': activity?.color ?? 'var(--color-orphan)',
          top: `${((start - day.start) / length) * 100}%`,
          // A two-minute entry is a thousandth of the day; without a floor it would be drawn as
          // nothing at all.
          height: `max(3px, ${fraction * 100}%)`,
          left: `${(lane / width) * 100}%`,
          width: `calc(${100 / width}% - 2px)`,
        } as CSSProperties
      }
      className="focus-ring activity-tint activity-rail pointer-events-auto absolute overflow-hidden rounded-md pl-2 text-left transition-[filter] hover:brightness-125"
    >
      {/* Only when the bar is tall enough to hold it. A 3px bar with two clipped words in it is less
          readable than a 3px bar. */}
      {fraction * timelineHeight >= LABEL_MIN_HEIGHT && (
        <span className="block truncate text-2xs leading-tight text-ink">
          {name}
          <span className="block text-ink-soft tabular-nums">{formatDuration(end - start)}</span>
        </span>
      )}
    </button>
  )
}

/**
 * Labelled lines down the day, so a bar can be read against a clock.
 *
 * Every hour when there is room for one, otherwise every second or third — and the line goes with
 * the label rather than staying behind on its own, because an unlabelled line between two labelled
 * ones is a tick nobody can name.
 *
 * The hour alone, not the time: every one of these is on the hour, so the `:00` would be
 * twenty-four repetitions of no information — and with it the label wrapped onto two lines inside
 * the gutter.
 */
function HourGrid({ day, height }: { day: TimeWindow; height: number }) {
  const hours = hoursIn(day)
  const step = labelStep(height / hours)

  return (
    <div aria-hidden className="absolute inset-0">
      {Array.from({ length: Math.ceil(hours / step) }, (_, index) => {
        const hour = index * step
        return (
          <div
            key={hour}
            className="absolute inset-x-0 flex items-start border-t border-line-subtle"
            style={{ top: `${(hour / hours) * 100}%` }}
          >
            <span className="w-12 pr-2 text-right text-2xs text-ink-muted">
              {formatHour(day.start + hour * HOUR)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * How many hours apart the labelled lines sit, given the pixels each hour gets.
 *
 * An 11px label needs about twice its own height around it to read as a row rather than a stack. The
 * thresholds are that, measured against `--text-2xs`.
 */
function labelStep(pixelsPerHour: number): number {
  if (pixelsPerHour >= 24) return 1
  if (pixelsPerHour >= 14) return 2
  return 3
}

/** `8 PM`, or `20` where the locale keeps a 24-hour clock. */
function formatHour(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric' })
}

/** Where the clock is, labelled. */
function NowLine({ day, now }: { day: TimeWindow; now: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 border-t border-accent-ink"
      style={{ top: `${((now - day.start) / (day.end - day.start)) * 100}%` }}
    >
      <span className="absolute left-0 -translate-y-1/2 rounded-sm bg-accent-ink px-1 text-2xs font-semibold text-canvas">
        now
      </span>
    </div>
  )
}

/**
 * The day's length in hours — 23 or 25 on the DST transition days, which is why this divides the day
 * rather than assuming 24.
 */
function hoursIn(day: TimeWindow): number {
  return Math.round((day.end - day.start) / HOUR)
}
