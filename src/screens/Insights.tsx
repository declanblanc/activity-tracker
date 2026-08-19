import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import EntryForm from '../components/EntryForm.tsx'
import { blankDraft, type Draft } from '../components/entryDraft.ts'
import { HeatGrid } from '../components/HeatGrid.tsx'
import Breakdown from '../components/insights/Breakdown.tsx'
import Coverage from '../components/insights/Coverage.tsx'
import FocusSummary from '../components/insights/FocusSummary.tsx'
import Goals from '../components/insights/Goals.tsx'
import Trend from '../components/insights/Trend.tsx'
import { IconButton } from '../components/ui/Button.tsx'
import PeriodStepper from '../components/ui/PeriodStepper.tsx'
import { getActivities } from '../data/activities.ts'
import { getCompletions } from '../data/completions.ts'
import { getEntriesInRange, getOpenEntries } from '../data/entries.ts'
import { getPref, setPref } from '../data/prefs.ts'
import { type Activity, type Period } from '../data/types.ts'
import { targetAt, type ScoredPeriod } from '../lib/accounting/goals.ts'
import { bucketTotals } from '../lib/accounting/totals.ts'
import { completionAmounts, dayAmounts, periodAmounts } from '../lib/days.ts'
import { periodLabel, thisPeriod } from '../lib/format.ts'
import { dateKey, dayWindowsIn, periodWindow, trailingWindows, type TimeWindow } from '../lib/time.ts'
import { useNow } from '../lib/useNow.ts'

const SCALES: Period[] = ['day', 'week', 'month']

/** How many columns of history the focused heat grid draws. */
const FOCUS_WEEKS = 53

/** Periods the trend chart shows, ending with the one being viewed. */
const TREND_PERIODS = 12

/**
 * Periods a streak may reach back through.
 *
 * ponytail: fixed, so one read covers every streak on screen. It caps both the current
 * and the longest streak at twelve periods, and for a monthly target it means reading a
 * year of entries. If either ceiling starts to matter, read per target period instead.
 */
const STREAK_PERIODS = 12

/**
 * Insights: where the time went, how much of the period was accounted for at all, and
 * whether the goals were met.
 *
 * Every number comes from `lib/accounting/` rather than from summing entries in place —
 * overlapping timers make "total per activity" and "tracked wall-clock" two different
 * computations, and only one of them may count shared time twice.
 *
 * This screen reads and lays out; every panel it draws lives in `components/insights/`.
 * That split is what keeps the read orchestration below legible — one query, one set of
 * windows, and a handful of panels handed the slices they need.
 *
 * `?activity=<id>` focuses the screen on one activity, which is where a Tracker card
 * links to. The focused view is a *selection* from the same numbers, not a second set of
 * them: every bucket already carries its per-activity totals, so focusing swaps which
 * series is charted and drops the panels that only make sense across activities.
 */
export default function Insights() {
  const now = useNow(30_000)
  const [scale, setScale] = useState<Period>(() => getPref('insightsScale'))
  const [anchor, setAnchor] = useState(() => Date.now())
  // A stretch of this activity being written down by hand. Only ever opened from the
  // focused view, so it starts out pointed at the activity on screen.
  const [draft, setDraft] = useState<Draft | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  // Archived activities included: their past time still happened, and the period it
  // falls in still has to account for it.
  const activities = useLiveQuery(() => getActivities(true), [])
  // Asked of the whole table rather than read out of the entries below: whether a timer
  // is running is a fact about now, and the entries read is bounded by the period being
  // browsed, which may be last May.
  const openEntries = useLiveQuery(() => getOpenEntries(), [])
  // Read whole, like the dashboard does: check-offs are small and bounding them would cap a
  // count activity's streak at whatever range happens to be on screen.
  const completions = useLiveQuery(() => getCompletions(), [])
  // An id that names nothing — a deleted activity, a stale link — simply falls back to
  // the unfocused screen rather than showing an empty one.
  const focus = activities?.find((activity) => activity.id === searchParams.get('activity'))

  const view = periodWindow(anchor, scale)
  const trend = trailingWindows(view.start, scale, TREND_PERIODS)
  // A streak is counted at the target's own period, which need not be the scale on
  // screen, so each target period in use gets its own run of windows.
  const streakWindows = new Map(
    targetPeriodsInUse(activities).map((period) => [
      period,
      trailingWindows(now, period, STREAK_PERIODS),
    ]),
  )

  // The year behind the focused check-off grid. It is in the read below because a day the timer
  // ran on now counts as checked off — so the grid needs that year of entries, not just the
  // period being browsed, or last spring's tracked days draw blank.
  const focusWeeks = focus ? trailingWindows(now, 'week', FOCUS_WEEKS) : []

  // One read for the whole screen, spanning every window it will compute over. The
  // bounds are period boundaries, so the once-a-tick `now` does not re-run the query —
  // only crossing into a new period does.
  const spans = [view, ...trend, ...[...streakWindows.values()].flat(), ...focusWeeks]
  const readStart = Math.min(...spans.map((span) => span.start))
  const readEnd = Math.max(...spans.map((span) => span.end))
  const entries = useLiveQuery(() => getEntriesInRange(readStart, readEnd), [readStart, readEnd])

  if (!activities || !entries || !completions) return null

  const focusDays = focusWeeks.flatMap((week) => dayWindowsIn(week))

  /**
   * One activity's amount in each of `windows` — days for a check-off, milliseconds for a timer.
   *
   * This is the bridge that lets the goals panel and the focused trend serve both measures from
   * one code path: `dayAmounts` erases the difference, and everything downstream is arithmetic.
   * The panels that stay duration-only below read `PeriodTotals` directly instead, because they
   * are about wall-clock coverage, which a check-off has nothing to say about.
   */
  const amountsFor = (activity: Activity, windows: TimeWindow[]): ScoredPeriod[] => {
    const days = dayWindowsIn({ start: readStart, end: Math.min(readEnd, now) })
    return periodAmounts(dayAmounts(activity, entries, completions, days, now), windows)
  }

  // These panels are about tracked wall-clock, so the records answer this, not any display
  // choice: every activity may hold intervals whatever card the Activities list gives it.
  const anyTimed = entries.length > 0
  const byPeriod = bucketTotals(entries, trend, now)
  // The trend's last bucket *is* the viewed period, so the comparison against the one
  // before it comes free.
  const current = byPeriod[byPeriod.length - 1]
  const previous = byPeriod[byPeriod.length - 2]
  // Only while the period on screen is the one the clock is in: a live timer above last
  // May's totals says nothing about last May.
  const runningSince =
    focus && contains(view, now)
      ? openEntries?.find((entry) => entry.activityId === focus.id)?.startedAt
      : undefined

  return (
    // A dashboard, so it earns more width than the lists do — but only past `xl`, where
    // there is room to stand two columns of panels beside each other rather than one
    // stretched one.
    <section className="screen-pad mx-auto w-full max-w-3xl xl:max-w-6xl">
      <div className="flex items-center gap-2">
        {focus && (
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-sm"
            style={{ backgroundColor: focus.color }}
          >
            {focus.icon}
          </span>
        )}
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-ink">
          {focus ? focus.name : 'Insights'}
        </h1>
        {/* Retroactive logging lives here because this is the screen where a gap is seen —
            a goal short by an hour is the hour you forgot to start.

            Offered for every activity: any of them can hold an interval, whichever card it
            shows on the Activities list.

            Icon-only: this header already carries a name and a way out of it, and the word
            "Add" cost enough width to truncate the activity's name to six characters on a
            phone. */}
        {focus && (
          <IconButton
            label="Add an entry"
            variant="primary"
            onClick={() => setDraft({ ...blankDraft(now), activityId: focus.id })}
          >
            <Plus className="size-4" aria-hidden />
          </IconButton>
        )}
        {/* The focus, both ways round. `?activity=` is still what the screen reads, so a link
            from a Tracker card and a pick here land in the same place — this only writes the
            same param the link does, including back to none. */}
        <select
          aria-label="Filter by activity"
          value={focus?.id ?? ''}
          onChange={(event) => {
            // The draft is pointed at the activity being left.
            setDraft(null)
            const chosen = event.target.value
            setSearchParams(chosen ? { activity: chosen } : {})
          }}
          className="focus-ring min-h-11 w-32 shrink-0 rounded-lg bg-raised px-3 text-sm font-medium text-ink"
        >
          <option value="">All activities</option>
          {activities.map((activity) => (
            // Archived activities are offered: their past time is still in these numbers.
            <option key={activity.id} value={activity.id}>
              {activity.name}
              {activity.archived ? ' (archived)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* One row, not two. The scale tabs and the period stepper used to stack into about
          160px of chrome before a single number appeared. The active tab is an underline
          rather than a filled blue slab: it marks which of three views you are in, which
          is not the same job as a button you press, and it was the loudest thing here. */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex shrink-0 gap-1" role="tablist" aria-label="Scale">
          {SCALES.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={option === scale}
              onClick={() => {
                setScale(option)
                setPref('insightsScale', option)
                // Back to the period the clock is in. Keeping the anchor would land the
                // new scale on the edge of the old period — switching to Day from a month
                // browsed back to May opens May 31, sixty taps from today.
                setAnchor(Date.now())
              }}
              className={`focus-ring min-h-11 rounded-lg px-3 text-sm font-medium capitalize transition-colors ${
                option === scale
                  ? 'bg-raised text-accent-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <PeriodStepper
          className="min-w-0 flex-1 md:max-w-72"
          label={contains(view, now) ? thisPeriod(scale) : periodLabel(view, scale)}
          previousLabel={`Previous ${scale}`}
          nextLabel={`Next ${scale}`}
          onPrevious={() => setAnchor(view.start - 1)}
          // Not past the period the clock is in: nothing is recorded ahead of now.
          onNext={view.end <= now ? () => setAnchor(view.end) : undefined}
        />
      </div>

      {draft && (
        <EntryForm
          className="panel mt-4 p-4"
          draft={draft}
          activities={activities}
          onChange={setDraft}
          onClose={() => setDraft(null)}
        />
      )}

      {current.length === 0 ? (
        <p className="mt-8 text-center text-sm text-ink-muted">This {scale} has not started yet.</p>
      ) : (
        // Past `xl`, two columns — as CSS columns rather than a grid. These four panels
        // have wildly different natural heights (a two-line summary beside a five-row
        // list), and a grid ties each row to its tallest cell, which is what left the old
        // layout with a column ending at 60% of the other. Columns balance by height
        // instead, and `break-inside-avoid` keeps a panel whole.
        <div className="xl:columns-2 xl:gap-6 [&>*]:break-inside-avoid">
          {focus ? (
            <FocusSummary
              activity={focus}
              current={current}
              previous={previous}
              scale={scale}
              runningSince={runningSince}
              history={amountsFor(focus, streakWindows.get(focus.targetPeriod ?? 'day') ?? [])}
              now={now}
            />
          ) : (
            // Coverage of the period, so it needs something timed to be coverage *of*.
            anyTimed && <Coverage current={current} previous={previous} scale={scale} />
          )}

          {/* Focused: this activity's own series, in its own unit. Unfocused: the tracked
              union, which only timed activities contribute to. */}
          {focus ? (
            <Trend
              periods={amountsFor(focus, trend)}
              scale={scale}
              measure={focus.measure}
              title={focus.name}
            />
          ) : (
            anyTimed && (
              <Trend
                periods={byPeriod.map((period) => ({ window: period.window, total: period.tracked }))}
                scale={scale}
                measure="duration"
                title="Tracked"
              />
            )
          )}

          {/* A list of every activity answers nothing when the screen is already about one of
              them, and it divides by the period length — which makes "share of the period" for
              five check-offs meaningless.
              ponytail: no count sibling to this panel. The goals panel covers the ones with a
              goal, and the dashboard's grid covers the rest. */}
          {!focus && anyTimed && (
            <Breakdown current={current} previous={previous} activities={activities} />
          )}

          <Goals
            // Passing the one activity is all the filtering the panel needs; it already skips
            // anything without a target at this scale.
            activities={focus ? [focus] : activities}
            scale={scale}
            currentAmount={(activity) => amountsFor(activity, [view])[0]?.total ?? 0}
            historyFor={(activity) => amountsFor(activity, streakWindows.get(scale) ?? [])}
            now={now}
          />

          {/* Anything checked off — see `HeatGrid`. Every activity can be, so this shows for any
              focused one. The squares come from the check-offs directly, since for a time-scored
              activity `dayAmounts` is milliseconds. A weekly target shades the columns only when
              it is measured in days. */}
          {focus && (
            <div className="panel mt-4 p-4">
              <h2 className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">
                {focus.measure === 'count' ? 'Past year' : 'Checked off'}
              </h2>
              <div className="mt-2">
                <HeatGrid
                  color={focus.color}
                  amounts={completionAmounts(focus.id, entries, completions, focusDays, now)}
                  today={dateKey(now)}
                  weeks={FOCUS_WEEKS}
                  weeklyTarget={
                    focus.measure === 'count' ? (targetAt(focus, 'week') ?? undefined) : undefined
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Every target period some unarchived activity actually uses. At most three. */
function targetPeriodsInUse(activities: Activity[] | undefined): Period[] {
  const periods = new Set<Period>()
  for (const activity of activities ?? []) {
    if (activity.targetAmount && activity.targetPeriod && !activity.archived) {
      periods.add(activity.targetPeriod)
    }
  }
  return [...periods]
}

const contains = (window: TimeWindow, at: number) => window.start <= at && at < window.end
