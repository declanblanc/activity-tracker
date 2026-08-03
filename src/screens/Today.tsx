import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays } from 'lucide-react'
import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import EntryForm from '../components/EntryForm.tsx'
import { draftFrom, type Draft } from '../components/entryDraft.ts'
import EmptyState from '../components/ui/EmptyState.tsx'
import { getActivities } from '../data/activities.ts'
import { getEntriesInRange } from '../data/entries.ts'
import { isOpen, type Activity, type Entry } from '../data/types.ts'
import { perActivityTotals } from '../lib/accounting/totals.ts'
import { formatDuration, formatTime } from '../lib/format.ts'
import { assignLanes, laneSpans } from '../lib/lanes.ts'
import { dayWindow, type TimeWindow } from '../lib/time.ts'
import { useNow } from '../lib/useNow.ts'

/** How tall one hour of the day is drawn. */
const HOUR_HEIGHT = 44

/** Below this a bar has no room for its own name, and two clipped words read as noise. */
const LABEL_MIN_HEIGHT = 26

/**
 * Today as a vertical timeline: time runs down, and simultaneous activities sit in
 * side-by-side lanes so none hides another.
 *
 * A bar is drawn from the entry's interval *clipped to today* — an entry that started
 * before midnight begins at the top edge rather than off-screen above it, and an open
 * entry ends at the current time and grows as the clock moves. The stored record is
 * never altered by any of that; clipping is a drawing concern.
 *
 * A bar's position is a fraction of the day's own length, not of a hard-coded 24
 * hours, so the timeline is still correct on the two days a year that are 23 or 25
 * hours long. That invariant is also why the empty hours are not collapsed to shorten
 * the page: a bar's height would stop meaning duration. The screen opens scrolled to now
 * instead, which is the problem the height was standing in for.
 *
 * Tapping a bar opens the same form the Log opens. This is the screen where a mistake is
 * usually spotted — a run that clearly did not last four hours is obvious as a shape long
 * before it is obvious as a row of numbers — so it is the screen that should be able to
 * fix it.
 */
export default function Today() {
  // 30s, not 1s: a bar grows by half a pixel a minute, so a per-second re-render of the
  // whole day would buy nothing visible.
  const now = useNow(30_000)
  const today = dayWindow(now)
  const entries = useLiveQuery(() => getEntriesInRange(today.start, today.end), [today.start])
  const activities = useLiveQuery(() => getActivities(true), [])
  const [draft, setDraft] = useState<Draft | null>(null)

  if (!entries || !activities) return null

  // Entries belong to timed activities only, so this screen is about them. A check-off has no
  // interval to draw or list; its history is the grid on the Activities screen.
  const timed = activities.filter((activity) => activity.measure === 'duration')
  // Archived ones count: their recorded stretches are still history this screen should list, and
  // the alternative message would tell an owner that nothing of theirs is timed when something is.
  const anyTimed = timed.length > 0

  const byId = new Map(activities.map((activity) => [activity.id, activity]))
  // Clip first, then pack: two entries that overlap only outside today must not be
  // pushed into separate lanes for an overlap the screen never shows.
  const bars = entries.map((entry) => ({
    entry,
    activity: byId.get(entry.activityId),
    start: Math.max(entry.startedAt, today.start),
    end: Math.min(isOpen(entry) ? now : entry.endedAt, today.end),
  }))
  const lanes = assignLanes(bars)
  // How many lanes each bar shares its width with, per overlapping cluster rather than
  // per day: one two-lane overlap at 09:00 used to halve every bar until midnight.
  const widths = laneSpans(bars, lanes)

  return (
    // Capped narrow: a day is drawn downwards, so extra width only stretches each bar
    // without showing more of anything.
    <section className="screen-pad mx-auto w-full max-w-2xl">
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink">Today</h1>
        <p className="text-sm text-ink-muted">
          {new Date(now).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
      </header>

      {bars.length === 0 ? (
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
          {/* Two states, because "nothing yet today" and "nothing here ever" call for
              different things. A timeline draws stretches of time, so an owner with only
              check-off activities would otherwise get a blank screen and no explanation —
              their history is a grid, and it is on the Activities screen. */}
          {anyTimed
            ? 'Nothing tracked today yet. Start a timer and it will draw itself here as the day goes on.'
            : 'The timeline draws timed stretches. None of your activities are timed — the ones you check off show their history on the Activities grid.'}
        </EmptyState>
      ) : (
        <>
          {draft && (
            <EntryForm
              key={draft.id}
              className="mt-4"
              draft={draft}
              activities={timed}
              onChange={setDraft}
              onClose={() => setDraft(null)}
            />
          )}

          {/* Above the timeline, as chips rather than a stack of rows: five full-width
              rows pushed the thing they summarise almost entirely off the screen. */}
          <ActivityTotals totals={perActivityTotals(entries, today, now)} byId={byId} />

          <div className="relative mt-4" style={{ height: hoursIn(today) * HOUR_HEIGHT }}>
            <HourGrid day={today} />

            {/* One absolutely positioned bar per entry, inset past the hour labels. The
                lane columns this replaced were flex children spanning the whole day, which
                is what forced a single width on all of them. */}
            <div className="absolute inset-y-0 right-0 left-12">
              {bars.map((bar, index) => (
                <Bar
                  key={bar.entry.id}
                  {...bar}
                  day={today}
                  lane={lanes[index]}
                  width={widths[index]}
                  onEdit={() => setDraft(draftFrom(bar.entry))}
                />
              ))}
            </div>

            <NowLine day={today} now={now} />
          </div>
        </>
      )}
    </section>
  )
}

/**
 * What today came to, per activity, longest first.
 *
 * These are per-activity totals, so timers that overlapped each count their time in full
 * and the chips can add up past the hours in a day. No reconciled figure is offered
 * alongside them, because the timeline below *is* the explanation — two bars side by side
 * is what an activity-hour counted twice looks like.
 *
 * Clipped to today like the bars are, so an entry that ran from last night contributes
 * only the part that falls after midnight.
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
    <ul className="mt-4 flex flex-wrap gap-2">
      {rows.map((row) => (
        <li
          key={row.activityId}
          className="flex items-center gap-2 rounded-full bg-surface py-1.5 pr-3 pl-2.5"
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: row.activity?.color ?? 'var(--color-orphan)' }}
          />
          <span className="text-xs font-medium text-ink">
            {row.activity?.name ?? 'Deleted activity'}
          </span>
          <span className="text-xs text-ink-muted tabular-nums">{formatDuration(row.total)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * One entry, drawn where it happened and tappable to correct it.
 *
 * The activity's colour arrives as `--activity` and is used as a tint plus a full-strength
 * rail down the leading edge — never as a surface with text on it. The fill used to be
 * the raw colour with white text over it, which for a light pick was around 2.3:1, and
 * the colour is the owner's to choose, so no palette fixes that.
 *
 * A short bar is a small target — a half-hour reads 22px and a five-minute entry hits the
 * 3px floor — which is below the 24px WCAG 2.5.8 asks for. That is not fixable here
 * without the height ceasing to mean duration, which is the screen's whole grammar. It
 * relies instead on that criterion's equivalent-control exception: every entry is also a
 * full-height row on the Log, opening this same form.
 */
function Bar({
  entry,
  activity,
  start,
  end,
  day,
  lane,
  width,
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
  onEdit: () => void
}) {
  const length = day.end - day.start
  const heightPercent = ((end - start) / length) * 100
  const name = activity?.name ?? 'Deleted activity'

  return (
    <button
      type="button"
      onClick={onEdit}
      // The name and both times, because the bar itself only has room for the name — and
      // on a short bar, not even that.
      aria-label={`Edit ${name}, ${formatTime(start)} to ${isOpen(entry) ? 'now' : formatTime(end)}`}
      style={
        {
          '--activity': activity?.color ?? 'var(--color-orphan)',
          top: `${((start - day.start) / length) * 100}%`,
          // A two-minute entry is a thousandth of the day; without a floor it would be
          // drawn as nothing at all.
          height: `max(3px, ${heightPercent}%)`,
          left: `${(lane / width) * 100}%`,
          width: `calc(${100 / width}% - 2px)`,
        } as CSSProperties
      }
      className="focus-ring activity-tint activity-rail absolute overflow-hidden rounded-md pl-2 text-left transition-[filter] hover:brightness-125"
    >
      {/* Only when the bar is tall enough to hold it. A 3px bar with two clipped words in
          it is less readable than a 3px bar. */}
      {heightPercent * (hoursIn(day) * HOUR_HEIGHT) >= LABEL_MIN_HEIGHT * 100 && (
        <span className="block truncate text-2xs leading-tight text-ink">
          {name}
          <span className="block text-ink-soft tabular-nums">{formatDuration(end - start)}</span>
        </span>
      )}
    </button>
  )
}

/**
 * One labelled line per local hour, so a bar can be read against a clock.
 *
 * The hour alone, not the time: every one of these is on the hour, so the `:00` was
 * twenty-four repetitions of no information — and with it the label wrapped onto two
 * lines inside the gutter.
 */
function HourGrid({ day }: { day: TimeWindow }) {
  const hours = hoursIn(day)

  return (
    <div aria-hidden className="absolute inset-0">
      {Array.from({ length: hours }, (_, hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 flex items-start border-t border-line-subtle"
          style={{ top: `${(hour / hours) * 100}%` }}
        >
          <span className="w-12 pr-2 text-right text-2xs text-ink-muted">
            {formatHour(day.start + hour * 60 * 60 * 1000)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** `8 PM`, or `20` where the locale keeps a 24-hour clock. */
function formatHour(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric' })
}

/**
 * Where the clock is, labelled, and what the screen scrolls to on arrival.
 *
 * The scroll is a ref callback rather than an effect: the element does not exist until
 * the live queries have resolved, so there is no mount for an effect to fire on at the
 * time it would need to. It is guarded to fire once, because the callback runs again on
 * every re-render whose element identity changes — and this screen re-renders every
 * thirty seconds, which would otherwise yank the page back twice a minute.
 */
function NowLine({ day, now }: { day: TimeWindow; now: number }) {
  const scrolled = useRef(false)
  const centre = useCallback((line: HTMLDivElement | null) => {
    if (!line || scrolled.current) return
    scrolled.current = true
    line.scrollIntoView({ block: 'center' })
  }, [])

  return (
    <div
      ref={centre}
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
 * The day's length in hours — 23 or 25 on the DST transition days, which is why this
 * divides the day rather than assuming 24.
 */
function hoursIn(day: TimeWindow): number {
  return Math.round((day.end - day.start) / (60 * 60 * 1000))
}
