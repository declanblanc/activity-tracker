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
import Highlights from '../components/insights/Highlights.tsx'
import Rhythm from '../components/insights/Rhythm.tsx'
import Standing from '../components/insights/Standing.tsx'
import Trend from '../components/insights/Trend.tsx'
import WhatGotDone from '../components/insights/WhatGotDone.tsx'
import WorthALook from '../components/insights/WorthALook.tsx'
import { IconButton } from '../components/ui/Button.tsx'
import PeriodStepper from '../components/ui/PeriodStepper.tsx'
import { getActivities } from '../data/activities.ts'
import { getCompletions } from '../data/completions.ts'
import { getEntriesForActivity, getEntriesInRange, getOpenEntries } from '../data/entries.ts'
import { getPref, setPref } from '../data/prefs.ts'
import { OPEN_ENTRY_END, type Activity, type DateKey, type Period } from '../data/types.ts'
import { streaks, targetAt, type ScoredPeriod } from '../lib/accounting/goals.ts'
import { bucketTotals } from '../lib/accounting/totals.ts'
import { personalBests } from '../lib/bests.ts'
import { strongestLink } from '../lib/correlate.ts'
import { completionAmounts, dayAmounts, periodAmounts } from '../lib/days.ts'
import { buildDigest, type ActivityDigestInput } from '../lib/digest.ts'
import { periodLabel, thisPeriod } from '../lib/format.ts'
import { leadingTotals, pace, type Pace } from '../lib/pace.ts'
import { weekdayProfile } from '../lib/rhythm.ts'
import { dateKey, dayWindowsIn, periodWindow, trailingWindows, type TimeWindow } from '../lib/time.ts'
import { useNow } from '../lib/useNow.ts'

const SCALES: Period[] = ['day', 'week', 'month']

/** How many columns of history the focused heat grid draws. */
const FOCUS_WEEKS = 53

/** Periods the trend chart shows, ending with the one being viewed. */
const TREND_PERIODS = 12

/**
 * Weeks the weekday profile averages over.
 *
 * Wide enough that every weekday has been seen a dozen or so times — a profile built from
 * three weeks is three Tuesdays, which is an anecdote. This is the widest span any unfocused
 * panel asks for, so it is what sets the floor on the screen's one read at the day scale.
 */
const RHYTHM_WEEKS = 15

/**
 * Periods a streak may reach back through.
 *
 * ponytail: fixed, so one read covers every streak on screen. It caps both the current
 * and the longest streak at twelve periods, and for a monthly target it means reading a
 * year of entries. If either ceiling starts to matter, read per target period instead.
 */
const STREAK_PERIODS = 12

/**
 * Insights: what is worth knowing, how the goals stand, and what shape the history has.
 *
 * Four questions, in that order of usefulness — *what should I know right now*, *am I doing
 * what I said I would*, *is this normal for me*, *what is the shape of it* — and one panel
 * answering each. It used to ask only one, how much wall-clock was accounted for, and answer
 * it four times; coverage now sits last and collapsed, because "51h untracked" is not a
 * finding, it is the rest of a life.
 *
 * Every number comes from `lib/accounting/` rather than from summing entries in place —
 * overlapping timers make "total per activity" and "tracked wall-clock" two different
 * computations, and only one of them may count shared time twice. Every *comparison* goes
 * through `lib/pace.ts`, so a period still running is never measured against a whole one.
 *
 * This screen reads and lays out; every panel lives in `components/insights/`.
 *
 * `?activity=<id>` focuses the screen on one activity, which is where a Tracker card
 * links to. The focused view is a *selection* from the same numbers, not a second set of
 * them — with two additions that only mean anything about one activity: its standing among
 * its own history, and the correlation read.
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

  /**
   * Every entry the focused activity has ever had, for its record book.
   *
   * The one read on this screen that is not bounded, and the one that is conditional: an
   * all-time best has no horizon by definition, and asking for one only when a reader has
   * opened a single activity is what keeps that affordable. See `bests.ts`.
   */
  const focusId = focus?.id
  const focusHistory = useLiveQuery(
    async () => (focusId ? getEntriesForActivity(focusId, 0, OPEN_ENTRY_END) : []),
    [focusId],
  )

  const view = periodWindow(anchor, scale)
  const trend = trailingWindows(view.start, scale, TREND_PERIODS)
  const rhythmWeeks = trailingWindows(now, 'week', RHYTHM_WEEKS)
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

  // One read for the whole screen, spanning every window it will compute over — widened to
  // whichever panel reaches furthest back, which at the day scale is the rhythm rather than the
  // trend. The bounds are period boundaries, so the once-a-tick `now` does not re-run the
  // query; only crossing into a new period does.
  const spans = [
    view,
    ...trend,
    ...rhythmWeeks,
    ...[...streakWindows.values()].flat(),
    ...focusWeeks,
  ]
  const readStart = Math.min(...spans.map((span) => span.start))
  const readEnd = Math.max(...spans.map((span) => span.end))
  const entries = useLiveQuery(() => getEntriesInRange(readStart, readEnd), [readStart, readEnd])

  if (!activities || !entries || !completions) return null

  const live = activities.filter((activity) => !activity.archived)
  const focusDays = focusWeeks.flatMap((week) => dayWindowsIn(week))
  // Every day the screen computes over, derived once. `pace`, `periodAmounts` and
  // `weekdayProfile` all look days up by key, so one map per activity serves every window.
  const readDays = dayWindowsIn({ start: readStart, end: Math.min(readEnd, now) })

  /**
   * One activity's day amounts — days for a check-off, milliseconds for a timer — cached for
   * the render.
   *
   * This is the bridge that lets the goals panel, the digest, the rhythm, the focused trend and
   * every pace comparison serve both measures from one code path: `dayAmounts` erases the
   * difference, and everything downstream is arithmetic. The panels that stay duration-only
   * read `PeriodTotals` instead, because they are about wall-clock coverage, which a check-off
   * has nothing to say about.
   */
  const amountCache = new Map<string, Map<DateKey, number>>()
  const amountsByDay = (activity: Activity): Map<DateKey, number> => {
    const cached = amountCache.get(activity.id)
    if (cached) return cached
    const fresh = dayAmounts(activity, entries, completions, readDays, now)
    amountCache.set(activity.id, fresh)
    return fresh
  }

  const amountsFor = (activity: Activity, windows: TimeWindow[]): ScoredPeriod[] =>
    periodAmounts(amountsByDay(activity), windows)

  // These panels are about tracked wall-clock, so the records answer this, not any display
  // choice: every activity may hold intervals whatever card the Activities list gives it.
  const anyTimed = entries.length > 0
  const byPeriod = bucketTotals(entries, trend, now)
  // The trend's last bucket *is* the viewed period, so the period before it comes free.
  const current = byPeriod[byPeriod.length - 1]
  const previous = byPeriod[byPeriod.length - 2]

  const viewDays = dayWindowsIn(view)
  // Said once in the goals header rather than on every row: how long the period has to run
  // is a fact about the period, not about any goal inside it. A single-day period reports
  // none — "1 day left" while looking at today is the calendar, not a deadline.
  const daysLeft = viewDays.length > 1 ? viewDays.filter((day) => day.end > now).length : 0
  const daysElapsed = viewDays.filter((day) => day.start <= now).length

  /**
   * Wall-clock time by day, for the coverage pace, each breakdown row's, and the rhythm.
   *
   * Bucketed by day and then summed, which is exact for the union as well as for the
   * per-activity totals: local days partition the period with no gap and no overlap, so the
   * union restricted to each day adds up to the union over the whole of it.
   */
  const trackedDays = readDays
  const trackedBuckets = bucketTotals(entries, trackedDays, now)
  const trackedByDay = new Map(
    trackedBuckets.map((bucket) => [dateKey(bucket.window.start), bucket.tracked]),
  )
  const timeByDay = new Map<string, Map<DateKey, number>>()
  for (const bucket of trackedBuckets) {
    const day = dateKey(bucket.window.start)
    for (const [activityId, total] of bucket.perActivity) {
      const own = timeByDay.get(activityId) ?? new Map<DateKey, number>()
      own.set(day, total)
      timeByDay.set(activityId, own)
    }
  }

  /** How far into the viewed period a series is, against the same span of the one before. */
  const paceOf = (amounts: Map<DateKey, number>): Pace => pace(amounts, view, previous.window, now)
  const timePace = (activityId: string) => paceOf(timeByDay.get(activityId) ?? new Map())

  const rhythmDays = readDays.filter((day) => day.start >= rhythmWeeks[0].start)
  const rhythmCaption = `last ${RHYTHM_WEEKS} weeks`

  // The digest is built from numbers the panels below already show — the work is in ranking
  // them, not in computing anything new.
  const digestInputs: ActivityDigestInput[] = (focus ? [focus] : live).map((activity) => {
    const target = targetAt(activity, scale)
    return {
      activity,
      goal:
        target === null
          ? undefined
          : {
              target,
              total: amountsFor(activity, [view])[0]?.total ?? 0,
              streak: streaks(amountsFor(activity, streakWindows.get(scale) ?? []), target, now),
            },
      trend: amountsFor(activity, trend),
    }
  })
  const highlights = buildDigest(digestInputs, scale, now)

  const bests = focus && focusHistory ? personalBests(focus, focusHistory, completions, now) : null

  /**
   * Where the viewed period sits among the ones behind it, with both sides cut to the same
   * span while it is still running. Ranking two days of this week among eleven finished weeks
   * is the part-against-whole mistake `pace` exists to stop, wearing a different hat.
   */
  const rankOf = (activity: Activity) => {
    const amounts = amountsByDay(activity)
    const own = paceOf(amounts)
    const behind = trend.slice(0, -1)
    if (behind.length === 0) return null

    if (!own.inProgress) {
      return {
        value: own.soFar,
        series: periodAmounts(amounts, behind).map((period) => period.total),
        partial: false,
      }
    }
    if (own.comparison === null) return null
    return {
      value: own.comparison.now,
      series: leadingTotals(amounts, behind, own.daysClosed),
      partial: true,
    }
  }
  // Every other activity is a candidate; the strongest describable pair wins, or none does.
  const link = focus
    ? strongestLink(
        { label: focus.name, days: amountsByDay(focus) },
        live
          .filter((activity) => activity.id !== focus.id)
          .map((activity) => ({
            label: activity.name,
            measure: activity.measure,
            days: amountsByDay(activity),
          })),
      )
    : null

  // Only while the period on screen is the one the clock is in: a live timer above last
  // May's totals says nothing about last May.
  const runningSince =
    focus && contains(view, now)
      ? openEntries?.find((entry) => entry.activityId === focus.id)?.startedAt
      : undefined

  return (
    // A dashboard, so it earns more width than the lists do. Two columns from `md` and three
    // from `xl`, as CSS columns rather than a grid: these panels have wildly different natural
    // heights, and a grid ties each row to its tallest cell, which is what left the old layout
    // with one column ending at 60% of the other. Columns balance by height instead, and
    // `break-inside-avoid` keeps a panel whole.
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
          160px of chrome before a single number appeared. The active tab is a raised chip
          rather than a filled blue slab: it marks which of three views you are in, which
          is not the same job as a button you press, and it was the loudest thing here. */}
      <div className="mt-2 flex items-center gap-1">
        <div className="flex shrink-0 gap-0.5" role="tablist" aria-label="Scale">
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
              className={`focus-ring min-h-11 rounded-lg px-2.5 text-sm font-medium capitalize transition-colors ${
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
        <div className="md:columns-2 md:gap-5 xl:columns-3 xl:gap-6 [&>*]:break-inside-avoid">
          <Highlights highlights={highlights} />

          {focus && (
            <FocusSummary
              activity={focus}
              current={current}
              scale={scale}
              runningSince={runningSince}
              history={amountsFor(focus, streakWindows.get(focus.targetPeriod ?? 'day') ?? [])}
              pace={timePace(focus.id)}
              now={now}
            />
          )}

          <Goals
            // Passing the one activity is all the filtering the panel needs; it already skips
            // anything without a target at this scale.
            activities={focus ? [focus] : activities}
            scale={scale}
            currentAmount={(activity) => amountsFor(activity, [view])[0]?.total ?? 0}
            historyFor={(activity) => amountsFor(activity, streakWindows.get(scale) ?? [])}
            paceFor={(activity) => paceOf(amountsByDay(activity))}
            daysLeft={daysLeft}
            now={now}
          />

          {focus && bests && (
            <Standing activity={focus} bests={bests} rank={rankOf(focus)} scale={scale} />
          )}

          {/* Focused: this activity's own series, in its own unit. Unfocused: the tracked
              union, which only timed activities contribute to.

              A check-off at the day scale gets no chart at all: its bars are twelve identical
              units, one per logged day, and a bar chart of a binary draws nothing the grid
              below does not draw better. This is the sanctioned kind of `measure` branch — it
              picks which components render, and computes no second number. */}
          {focus ? (
            !(focus.measure === 'count' && scale === 'day') && (
              <Trend
                periods={amountsFor(focus, trend)}
                scale={scale}
                measure={focus.measure}
                title={focus.name}
                projected={paceOf(amountsByDay(focus)).projected}
                now={now}
              />
            )
          ) : (
            anyTimed && (
              <Trend
                periods={byPeriod.map((period) => ({ window: period.window, total: period.tracked }))}
                scale={scale}
                measure="duration"
                title="Tracked"
                projected={paceOf(trackedByDay).projected}
                now={now}
              />
            )
          )}

          {/* The weekday shape, which no scale on this screen can show: a trend says when a run
              of periods happened, never that every one of them happened on a Saturday. */}
          {focus ? (
            <Rhythm
              profile={weekdayProfile(amountsByDay(focus), rhythmDays, now)}
              measure={focus.measure}
              color={focus.color}
              caption={rhythmCaption}
            />
          ) : (
            anyTimed && (
              <Rhythm
                profile={weekdayProfile(trackedByDay, rhythmDays, now)}
                measure="duration"
                caption={rhythmCaption}
              />
            )
          )}

          {/* The check-off axis of the aggregate view. Three panels here used to be gated on
              there being any tracked time at all, so someone keeping habits and no timers saw
              the goals list and nothing else. */}
          {!focus && (
            <WhatGotDone
              daysElapsed={daysElapsed}
              rows={live.map((activity) => ({
                activity,
                done: sumOver(
                  completionAmounts(activity.id, entries, completions, viewDays, now),
                  viewDays,
                ),
              }))}
            />
          )}

          {/* A list of every activity answers nothing when the screen is already about one of
              them, and it divides by the period length — which makes "share of the period" for
              five check-offs meaningless. */}
          {!focus && anyTimed && (
            <Breakdown current={current} activities={activities} scale={scale} paceFor={timePace} />
          )}

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

          {focus && <WorthALook sentence={link} />}

          {/* Coverage of the period, so it needs something timed to be coverage *of*. Last and
              collapsed: it is context for the panels above, not the headline it used to be. */}
          {!focus && anyTimed && (
            <Coverage current={current} scale={scale} pace={paceOf(trackedByDay)} />
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

/** One amount map summed over the days of a window. */
function sumOver(amounts: Map<DateKey, number>, days: TimeWindow[]): number {
  return days.reduce((total, day) => total + (amounts.get(dateKey(day.start)) ?? 0), 0)
}

const contains = (window: TimeWindow, at: number) => window.start <= at && at < window.end
