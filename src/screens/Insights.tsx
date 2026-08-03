import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link, useSearchParams } from 'react-router'
import EntryForm from '../components/EntryForm.tsx'
import { blankDraft, type Draft } from '../components/entryDraft.ts'
import { IconButton } from '../components/ui/Button.tsx'
import Meter from '../components/ui/Meter.tsx'
import PeriodStepper from '../components/ui/PeriodStepper.tsx'
import { HeatGrid } from '../components/HeatGrid.tsx'
import Stat from '../components/ui/Stat.tsx'
import { getActivities } from '../data/activities.ts'
import { getCompletions } from '../data/completions.ts'
import { getEntriesInRange, getOpenEntries } from '../data/entries.ts'
import { getPref, setPref } from '../data/prefs.ts'
import type { Activity, Measure, Period } from '../data/types.ts'
import { streaks, targetAt, type ScoredPeriod } from '../lib/accounting/goals.ts'
import { bucketTotals, type PeriodTotals } from '../lib/accounting/totals.ts'
import { dayAmounts, periodAmounts } from '../lib/days.ts'
import { formatAmount, formatDuration, formatElapsed } from '../lib/format.ts'
import { dateKey, dayWindowsIn, periodWindow, trailingWindows, type TimeWindow } from '../lib/time.ts'
import { useNow } from '../lib/useNow.ts'

const HOUR = 60 * 60 * 1000
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
  const [searchParams] = useSearchParams()
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

  // One read for the whole screen, spanning every window it will compute over. The
  // bounds are period boundaries, so the once-a-tick `now` does not re-run the query —
  // only crossing into a new period does.
  const spans = [view, ...trend, ...[...streakWindows.values()].flat()]
  const readStart = Math.min(...spans.map((span) => span.start))
  const readEnd = Math.max(...spans.map((span) => span.end))
  const entries = useLiveQuery(() => getEntriesInRange(readStart, readEnd), [readStart, readEnd])

  if (!activities || !entries || !completions) return null

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

  const anyTimed = activities.some(
    (activity) => activity.measure === 'duration' && !activity.archived,
  )
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
        {focus && (
          <>
            {/* Retroactive logging lives here because this is the screen where a gap is seen —
                a goal short by an hour is the hour you forgot to start.

                Timed activities only: a check-off has no interval to write, and its equivalent
                gesture is ticking a past square on the year grid below.

                Icon-only, unlike the Log's `+ Add`: this header already carries a name and a way
                out of it, and the word "Add" cost enough width to truncate the activity's name to
                six characters on a phone. */}
            {focus.measure === 'duration' && (
              <IconButton
                label="Add an entry"
                variant="primary"
                onClick={() => setDraft({ ...blankDraft(now), activityId: focus.id })}
              >
                <Plus className="size-4" aria-hidden />
              </IconButton>
            )}
            <Link
              to="/insights"
              onClick={() => setDraft(null)}
              className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-lg bg-raised px-4 text-sm font-medium text-ink transition-colors hover:bg-raised-hover"
            >
              All activities
            </Link>
          </>
        )}
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
          className="mt-4"
          draft={draft}
          // Only a timed activity can hold an interval, so only they are offered.
          activities={activities.filter((activity) => activity.measure === 'duration')}
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
            anyTimed && <Summary current={current} previous={previous} scale={scale} />
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

          {/* Both measures. For a check-off activity this is what replaces the retroactive `+`
              in the header; for a timed one, "which days did I do any of this at all" is a
              question the trend cannot answer. */}
          {focus && (
            <div className="panel mt-4 p-4">
              <h2 className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">
                Past year
              </h2>
              <div className="mt-2">
                <HeatGrid
                  activity={focus}
                  amounts={dayAmounts(
                    focus,
                    entries,
                    completions,
                    dayWindowsIn({ start: readStart, end: Math.min(readEnd, now) }),
                    now,
                  )}
                  today={dateKey(now)}
                  weeks={FOCUS_WEEKS}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Tracked wall-clock and what it left untracked, plus the change against the period
 * before.
 *
 * Tracked is the *union* of every interval, so it cannot exceed the period length even
 * when four timers ran at once — which is what makes untracked meaningful. The
 * denominator is the period clamped to now, so a fully-tracked morning reads 0
 * untracked rather than owing the rest of the day.
 */
function Summary({
  current,
  previous,
  scale,
}: {
  current: PeriodTotals
  previous: PeriodTotals
  scale: Period
}) {
  return (
    <div className="panel mt-4 p-4">
      <p className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">Tracked this {scale}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">
        {formatDuration(current.tracked)}
      </p>
      {/* The coverage the two bare numbers left the reader to work out. Untracked is the
          remainder of this bar, which is why it needs no second card. */}
      <Meter fraction={current.length > 0 ? current.tracked / current.length : 0} />
      <p className="mt-2 text-xs text-ink-muted">
        {formatDuration(current.untracked)} untracked of {formatDuration(current.length)} so far
      </p>
      <Delta from={previous.tracked} to={current.tracked} label={`vs previous ${scale}`} />
    </div>
  )
}

/**
 * The viewed period for the one activity on screen.
 *
 * The two measures genuinely have different things to say here, so this is the one panel that
 * branches. A timed activity reports its time and what share of the tracked union it accounts
 * for; a check-off reports its streaks, because "share of tracked time" is meaningless for
 * something that takes no measurable time.
 *
 * The share is measured against the tracked union rather than the period, so it answers "of the
 * time I accounted for, how much was this". It can reach 100% for an activity that ran alongside
 * others the whole time — overlapping timers each own their time in full, and these shares are
 * not meant to add up to 100 across activities.
 */
function FocusSummary({
  activity,
  current,
  previous,
  scale,
  runningSince,
  history,
  now,
}: {
  activity: Activity
  current: PeriodTotals
  previous: PeriodTotals
  scale: Period
  /** When the running stretch began, if this activity's timer is going. */
  runningSince?: number
  /** This activity's amounts at its own target period, for the streaks. */
  history: ScoredPeriod[]
  now: number
}) {
  if (activity.measure === 'count') {
    const target = targetAt(activity, activity.targetPeriod ?? 'day') ?? 1
    const { current: streak, longest } = streaks(history, target, now)
    const unit = activity.targetPeriod === 'week' ? 'weeks' : 'days'
    const done = history.reduce((sum, period) => sum + period.total, 0)

    return (
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Current" value={streak} unit={unit} />
        <Stat label="Longest" value={longest} unit={unit} />
        <Stat label="Logged" value={done} unit="days" />
      </dl>
    )
  }

  const total = current.perActivity.get(activity.id) ?? 0
  const share = current.tracked > 0 ? total / current.tracked : 0

  return (
    <div className="mt-4 flex gap-3">
      <div className="panel flex-1 p-3">
        <p className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">Time</p>
        <p className="text-xl font-semibold text-ink tabular-nums">{formatDuration(total)}</p>
        {/* Above the delta rather than below it: it explains why the number over it is still
            moving, which the comparison to last week does not. */}
        {runningSince !== undefined && <RunningTimer startedAt={runningSince} />}
        <Delta
          from={previous.perActivity.get(activity.id) ?? 0}
          to={total}
          label={`vs previous ${scale}`}
        />
      </div>
      <div className="panel flex-1 p-3">
        <p className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">
          Share of tracked
        </p>
        <p className="text-xl font-semibold text-ink tabular-nums">{Math.round(share * 100)}%</p>
        <Meter fraction={share} color={activity.color} />
      </div>
    </div>
  )
}

/**
 * The running stretch, counting up.
 *
 * It keeps its own clock rather than reading the screen's `now`, which ticks every 30
 * seconds: every number on this screen costs a pass over up to a year of entries, and a
 * timer that only moved twice a minute would look stuck. Re-rendering one span each
 * second is free; re-running the accounting each second is not.
 *
 * The count alone, with no "since 6:45 PM" after it. This sits in a card about a third of
 * a phone's width, where the start time wrapped onto a second line — and a bare clock
 * time is a lie about the stretch that has been open since Friday, which is exactly the
 * one worth noticing. The Log and Today both name the start.
 */
function RunningTimer({ startedAt }: { startedAt: number }) {
  const now = useNow()

  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
      <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
      Running <span className="tabular-nums">{formatElapsed(now - startedAt)}</span>
    </p>
  )
}

/**
 * One number per period, with the viewed period picked out.
 *
 * Fed `ScoredPeriod[]` rather than `PeriodTotals[]`, which is what lets it chart either measure:
 * a check-off activity's bars are days per period and a timed one's are hours, and only the axis
 * and the tooltip need to know which.
 */
function Trend({
  periods,
  scale,
  measure,
  title,
}: {
  periods: ScoredPeriod[]
  scale: Period
  /** Decides the unit on the axis and in the tooltip. */
  measure: Measure
  /** Names the series, in the caption and the tooltip. */
  title: string
}) {
  // Hours for a duration, so the axis reads in a human unit; a plain count of days otherwise.
  const scaleOf = (total: number) => (measure === 'duration' ? total / HOUR : total)
  const data = periods.map((period, index) => ({
    label: tickLabel(period.window, scale),
    full: periodLabel(period.window, scale),
    value: scaleOf(period.total),
    viewed: index === periods.length - 1,
  }))

  if (data.length === 0 || data.every((row) => row.value === 0)) {
    return (
      <p className="mt-6 text-center text-sm text-ink-muted">
        Nothing recorded in the last {data.length} {scale}s.
      </p>
    )
  }

  const mean = data.reduce((sum, row) => sum + row.value, 0) / data.length
  /** Back from the axis unit into the amount `formatAmount` expects. */
  const unscale = (value: number) => (measure === 'duration' ? value * HOUR : value)
  // A count average is usually fractional — four logged days over twelve weeks is 0.33 — and
  // `formatAmount` rounds to whole days, which would print "0 days" for it. One decimal place
  // is the smallest thing that stops the average reading as nothing.
  const meanLabel =
    measure === 'duration'
      ? formatAmount('duration', unscale(mean))
      : `${mean.toFixed(1)} ${mean === 1 ? 'day' : 'days'}`

  return (
    <div className="panel mt-4 p-4">
      <h2 className="flex items-baseline gap-2 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        {title} by {scale}
        <span className="font-normal tracking-normal normal-case tabular-nums">
          avg {meanLabel}
        </span>
      </h2>
      {/* The chart fills a box the layout sizes, rather than carrying a fixed pixel height of
          its own: given twice the width it would otherwise draw twelve bars as twelve stretched
          slabs. Taller on desktop keeps the aspect ratio sane. */}
      <div className="mt-2 h-40 w-full md:h-56">
        {/* Fed one pre-aggregated row per period, never raw entries. */}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            {/* Recharts passes these straight through to SVG attributes, which resolve `var()`
                like any other CSS — so the chart reads the same tokens the rest of the screen
                does instead of carrying eight hardcoded hexes. */}
            <XAxis
              dataKey="label"
              interval="preserveStartEnd"
              tick={{ fill: 'var(--color-ink-muted)', fontSize: 11 }}
              stroke="var(--color-line)"
            />
            <YAxis
              width={32}
              allowDecimals={false}
              tick={{ fill: 'var(--color-ink-muted)', fontSize: 11 }}
              stroke="var(--color-line)"
              tickFormatter={(value: number) => (measure === 'duration' ? `${value}h` : `${value}`)}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-canvas)',
                border: '1px solid var(--color-line)',
                borderRadius: 8,
              }}
              labelStyle={{ color: 'var(--color-ink)' }}
              formatter={(value) => [formatAmount(measure, unscale(Number(value))), title]}
              labelFormatter={(_, payload) => payload?.[0]?.payload.full ?? ''}
            />
            {/* Twelve bars of similar height say nothing without something to be similar *to*.
                Already in the bundle, so it costs no bytes. */}
            <ReferenceLine y={mean} stroke="var(--color-ink-subtle)" strokeDasharray="3 3" />
            {/* Animation off: the bars grow from zero over 1.5s on every render, which on a
                screen whose period nav is two taps apart reads as lag, not as motion.
                `maxBarSize` so twelve bars across a wide panel stay bars rather than spreading
                into a solid block. */}
            <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false}>
              {data.map((row) => (
                <Cell
                  key={row.full}
                  fill={row.viewed ? 'var(--color-accent)' : 'var(--color-raised)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/**
 * Time per activity for the viewed period, longest first.
 *
 * These sum to more than the tracked union whenever timers overlapped, and that is
 * correct: the two numbers answer different questions and are not reconciled.
 */
function Breakdown({
  current,
  previous,
  activities,
}: {
  current: PeriodTotals
  previous: PeriodTotals
  activities: Activity[]
}) {
  // The clamped period: the same denominator the coverage panel and the Tracker's day
  // summary use, so a bar means the same thing everywhere it appears.
  const period = current.length
  const byId = new Map(activities.map((activity) => [activity.id, activity]))
  const rows = [...current.perActivity]
    .map(([activityId, total]) => ({
      activityId,
      total,
      was: previous.perActivity.get(activityId) ?? 0,
      activity: byId.get(activityId),
    }))
    .sort((a, b) => b.total - a.total)

  if (rows.length === 0) {
    return (
      <p className="mt-6 text-center text-sm text-ink-muted">Nothing tracked in this period.</p>
    )
  }

  return (
    <div className="panel mt-4">
      <h2 className="text-2xs font-semibold tracking-widest text-ink-muted uppercase px-4 pt-4">Where the time went</h2>
      {/* One panel of rows rather than a card each: twenty identical cards gave the eye
          nowhere to start, and the group is one thing. */}
      <ul className="mt-1 flex flex-col">
        {rows.map((row) => (
          <li key={row.activityId} className="border-t border-line-subtle px-4 py-3 first:border-t-0">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {row.activity?.name ?? 'Deleted activity'}
              </span>
              <span className="text-sm text-ink-soft tabular-nums">{formatDuration(row.total)}</span>
            </div>
            {/* Against the period, not against the biggest row. Scaling to the largest
                total made the top row's bar permanently full, which reads as a goal met —
                the one thing a full bar should mean. */}
            <Meter
              fraction={period > 0 ? row.total / period : 0}
              color={row.activity?.color ?? 'var(--color-orphan)'}
            />
            <Delta from={row.was} to={row.total} label="vs previous" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Progress and streaks for the targets belonging to the scale on screen.
 *
 * Both measures, through one code path. A check-off activity's "3 of 5 this week" and a timed
 * one's "2h45m of 4h today" differ only in what `formatAmount` prints — the meter, the verdict,
 * the percentage and the streak are the same arithmetic on the same shape.
 *
 * `historyFor` returns that scale's trailing windows, so a weekly target's streak counts weeks: a
 * target is never scored, or pro-rated, at a scale it was not set at.
 */
function Goals({
  activities,
  scale,
  currentAmount,
  historyFor,
  now,
}: {
  activities: Activity[]
  scale: Period
  /** This activity's amount in the viewed period, in its own unit. */
  currentAmount: (activity: Activity) => number
  /** This activity's amounts across the trailing windows of `scale`. */
  historyFor: (activity: Activity) => ScoredPeriod[]
  now: number
}) {
  const scored = activities.flatMap((activity) => {
    const target = activity.archived ? null : targetAt(activity, scale)
    return target === null ? [] : [{ activity, target }]
  })

  if (scored.length === 0) return null

  return (
    <div className="panel mt-4">
      <h2 className="px-4 pt-4 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Goals this {scale}
      </h2>
      <ul className="mt-1 flex flex-col">
        {scored.map(({ activity, target }) => {
          const total = currentAmount(activity)
          const met = total >= target
          const streak = streaks(historyFor(activity), target, now)

          return (
            <li
              key={activity.id}
              className="border-t border-line-subtle px-4 py-3 first:border-t-0"
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {activity.name}
                </span>
                <span className="text-sm text-ink-soft tabular-nums">
                  {formatAmount(activity.measure, total, true)} /{' '}
                  {formatAmount(activity.measure, target)}
                </span>
              </div>
              {/* The one bar in the app whose fullness is a verdict, so the one place a status
                  colour is earned. */}
              <Meter
                fraction={total / target}
                color={met ? 'var(--color-positive)' : activity.color}
              />
              <p className="mt-1 text-xs text-ink-muted">
                {met ? (
                  <span className="text-positive">Goal met</span>
                ) : (
                  // Floored, so an in-progress period reads as partial rather than as failed —
                  // it has not run out of time yet.
                  `${Math.floor((total / target) * 100)}% there`
                )}
                {' · '}
                {streak.current > 0 ? `${streak.current} ${scale} streak` : 'No streak'}
                {streak.longest > streak.current && `, longest ${streak.longest}`}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The change from one period to the next.
 *
 * Always a duration, never a percentage: a period with no prior data is a zero baseline,
 * and "+∞%" is not a number to show anyone. The arrow carries the direction.
 *
 * Deliberately colourless. Up was green and down was amber, which asserted that more of
 * everything is better — wrong for sleep, wrong for anything with a ceiling, and exactly
 * backwards for untracked time. The app knows which direction is good in precisely one
 * place, a target, so that is the only place a colour appears.
 */
function Delta({ from, to, label }: { from: number; to: number; label: string }) {
  const change = to - from

  if (change === 0) {
    return <p className="mt-1 text-xs text-ink-muted">No change {label}</p>
  }

  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
      {change > 0 ? (
        <ArrowUp aria-hidden className="size-3 shrink-0" />
      ) : (
        <ArrowDown aria-hidden className="size-3 shrink-0" />
      )}
      <span className="text-ink-soft tabular-nums">{formatDuration(Math.abs(change))}</span>
      {label}
    </p>
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

const thisPeriod = (scale: Period) => ({ day: 'Today', week: 'This week', month: 'This month' })[scale]

/** `Fri, Jul 31`, `Jul 26 – Aug 1`, or `July 2026`. */
function periodLabel(window: TimeWindow, scale: Period): string {
  const date = (at: number, options: Intl.DateTimeFormatOptions) =>
    new Date(at).toLocaleDateString([], options)

  if (scale === 'month') return date(window.start, { month: 'long', year: 'numeric' })
  if (scale === 'day') return date(window.start, { weekday: 'short', month: 'short', day: 'numeric' })

  const day = { month: 'short', day: 'numeric' } as const
  // The window end is exclusive, so the label names the last day inside it.
  return `${date(window.start, day)} – ${date(window.end - 1, day)}`
}

/**
 * The short form that fits under a bar. A bare day number is ambiguous once the run of
 * weeks crosses a month, so a week is labelled by the month too; the axis drops whatever
 * does not fit and the tooltip carries the full range either way.
 */
function tickLabel(window: TimeWindow, scale: Period): string {
  const options: Intl.DateTimeFormatOptions =
    scale === 'month' ? { month: 'short' } : scale === 'week' ? { month: 'short', day: 'numeric' } : { day: 'numeric' }
  return new Date(window.start).toLocaleDateString([], options)
}
