import { Pause, Play, Square } from 'lucide-react'
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { Activity, DateKey } from '../data/types.ts'
import { targetAt } from '../lib/accounting/goals.ts'
import { formatAmount } from '../lib/format.ts'
import { GAP, SQUARE, weeksThatFit } from '../lib/heatStrip.ts'
import { formatKey, shiftKey } from '../lib/time.ts'
import { HeatGrid } from './HeatGrid.tsx'
import { TimerReading } from './TimerReading.tsx'
import { IconButton } from './ui/Button.tsx'

/**
 * The dashboard's cards. Two components rather than one with a branch, over a shared shell
 * and a shared heat strip.
 *
 * A single component would take eight props a check-off card ignores and one a timed card
 * ignores, and a discriminated prop union cannot narrow from a nested `activity.measure`, so
 * it would need a `measure` prop redundant with the record. The rule applied here is: share
 * the code that is hard to get right, and let the markup that is easy to read be read twice.
 *
 * (`ActivitySheet` makes the opposite call, for the opposite reason — there the
 * measure-specific part is one block among six.)
 */

/** However wide a card grows, half a year of squares is enough of a glance. */
export const CARD_MAX_WEEKS = 26

/**
 * Weeks the card's strip has room for, remeasured as it resizes.
 *
 * The dashboard is a glance: a strip that has to be scrolled to reach today costs more than
 * the history it holds, and the whole year is one tap away in the detail sheet. So the card
 * asks for what fits and nothing more.
 */
function useFittingWeeks(max: number) {
  const [weeks, setWeeks] = useState(max)
  const observer = useRef<ResizeObserver | null>(null)

  // A callback ref rather than an effect, so the measurement re-runs every time the strip node
  // mounts. The strip is unmounted whenever the card switches to compact; an effect keyed on
  // `max` would not re-observe the fresh node on the way back, leaving `weeks` stuck at a stale
  // value and the grid drawn as a sliver pinned to one edge.
  const strip = useCallback(
    (element: HTMLDivElement | null) => {
      observer.current?.disconnect()
      if (!element) return

      const measure = () => setWeeks(Math.min(max, weeksThatFit(element.clientWidth)))
      measure()

      observer.current = new ResizeObserver(measure)
      observer.current.observe(element)
    },
    [max],
  )

  return [strip, weeks] as const
}

/** The compact strip's span: the last week, at a glance. */
const COMPACT_DAYS = 7

/**
 * The last seven days as a single horizontal row — the compact card's heat strip.
 *
 * The full grid is seven rows tall whatever its width, which is the wrong shape for a card meant
 * to pack tight. This lays the recent week along one row instead: short enough to keep the card
 * compact, long enough to still show the current run. Squares reuse the grid's own styling and
 * stay clickable, so a missed day is backfilled here too. No weekly-target shading — a single row
 * has no week columns to score, and the run of solid squares is the whole story at this size.
 */
function WeekStrip({
  color,
  amounts,
  today,
  onToggleDay,
}: {
  color: string
  amounts: Map<DateKey, number>
  today: DateKey
  onToggleDay?: (day: DateKey) => void
}) {
  const days = Array.from({ length: COMPACT_DAYS }, (_, index) =>
    shiftKey(today, index - (COMPACT_DAYS - 1)),
  )

  return (
    <div
      className="mt-3 flex"
      style={{ '--activity': color, gap: `${GAP}px` } as CSSProperties}
    >
      {days.map((day) => {
        const done = (amounts.get(day) ?? 0) > 0
        const shared = {
          className: 'heat-square',
          style: { width: SQUARE, height: SQUARE } as CSSProperties,
          'data-credit': done ? 'full' : 'none',
          'data-today': day === today,
          title: formatKey(day),
        }
        const label = `${formatKey(day)} — ${done ? 'completed' : 'not completed'}`

        if (!onToggleDay) return <div key={day} {...shared} aria-label={label} />

        return (
          <button
            key={day}
            type="button"
            {...shared}
            aria-label={label}
            aria-pressed={done}
            onClick={() => onToggleDay(day)}
          />
        )
      })}
    </div>
  )
}

type Shared = {
  activity: Activity
  onOpen: () => void
}

const streakLabel = (length: number, unit: 'day' | 'week') =>
  length > 0 ? `${length} ${unit} streak` : 'No streak yet'

/**
 * The line under an activity's name, for whichever question the card is currently answering.
 *
 * A weekly goal leads with this week's progress: it is the number its owner is steering by, and
 * it moves on every log, where the streak only moves once a week.
 */
function goalSummary(
  activity: Activity,
  thisPeriod: number,
  streak: number,
  total: number,
): string {
  const weekly = targetAt(activity, 'week')
  if (weekly !== null) {
    const done = formatAmount(activity.measure, thisPeriod, true)
    const goal = formatAmount(activity.measure, weekly, true)
    return `${done} of ${goal} this week · ${streakLabel(streak, 'week')}`
  }
  return `${streakLabel(streak, 'day')} · ${formatAmount(activity.measure, total)} total`
}

/**
 * The card shell: the surface, the identity block and the one control beside it.
 *
 * Anything below that is the measure's own business — which in practice means the check-off card's
 * heat strip, since a timed card has nothing a grid could honestly say.
 */
function CardShell({
  activity,
  onOpen,
  summary,
  tinted = false,
  action,
  children,
}: Shared & {
  summary: ReactNode
  tinted?: boolean
  action: ReactNode
  children?: ReactNode
}) {
  return (
    // `panel` supplies the surface, and `activity-tint` cannot join it here: the tint sets
    // `background-color` too, so it would replace the panel's fill rather than sit on it. The
    // tint goes on the inner wrapper instead, which is why the padding does too — it has to
    // cover the whole card for the tint to.
    <div className={`panel ${activity.archived ? 'opacity-50' : ''}`}>
      {/* The activity's colour reaches the card through one custom property, and only as a
          tint, a rail and a dot — never under text. See `activity-tint` in index.css. */}
      <div
        style={{ '--activity': activity.color } as CSSProperties}
        className={`rounded-2xl p-4 ${tinted ? 'activity-tint activity-rail' : ''}`}
      >
        <div className="flex items-start gap-3">
          {/* The title block is the affordance for the detail sheet, rather than the whole
              card — a card-wide click would fight every square in a grid below it. */}
          <button
            type="button"
            onClick={onOpen}
            className="focus-ring group flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
          >
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm"
              style={{ backgroundColor: activity.color }}
            >
              {activity.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink transition-colors group-hover:text-accent-ink">
                {activity.name}
              </span>
              {/* A tinted card lifts this line a step: `ink-muted` on any tint at all is
                  under 4.5:1, and the tint is the owner's colour, so it could be white. */}
              <span
                className={`block truncate text-xs tabular-nums ${
                  tinted ? 'text-ink-soft' : 'text-ink-muted'
                }`}
              >
                {activity.archived ? 'Archived' : summary}
              </span>
            </span>
          </button>

          {/* Archived activities get no controls: archiving stops the timer, and something
              off the dashboard must not start accruing again or accept a new check-off. */}
          {!activity.archived && action}
        </div>

        {children}
      </div>
    </div>
  )
}

/**
 * A check-off activity: one round toggle for today, and a strip whose squares toggle any past
 * day. Backfilling a missed day is just clicking an older square.
 */
export function CountCard({
  amounts,
  today,
  thisWeek,
  streak,
  total,
  compact = false,
  onToggleToday,
  onToggleDay,
  ...shared
}: Shared & {
  /** day → 1 for a logged day, from `dayAmounts`. */
  amounts: Map<DateKey, number>
  today: DateKey
  /** Check-offs so far this week, for a weekly goal's progress line. */
  thisWeek: number
  streak: number
  total: number
  /** Trade the full grid for a one-row last-seven-days strip, so the card packs tighter. */
  compact?: boolean
  onToggleToday: () => void
  onToggleDay: (day: DateKey) => void
}) {
  const { activity } = shared
  const doneToday = (amounts.get(today) ?? 0) > 0
  const [strip, weeks] = useFittingWeeks(CARD_MAX_WEEKS)

  return (
    <CardShell
      {...shared}
      summary={goalSummary(activity, thisWeek, streak, total)}
      action={
        <button
          type="button"
          onClick={onToggleToday}
          aria-pressed={doneToday}
          aria-label={doneToday ? `Un-log ${activity.name} for today` : `Log ${activity.name} for today`}
          // The "pop": a CSS transform on press. A spring library would buy nothing a 120ms
          // scale cannot.
          className="focus-ring grid size-11 shrink-0 place-items-center rounded-full text-lg font-semibold transition-transform duration-100 active:scale-90"
          style={{
            backgroundColor: doneToday ? activity.color : 'transparent',
            boxShadow: doneToday ? 'none' : `inset 0 0 0 2px ${activity.color}`,
            color: doneToday ? 'var(--color-slate-950)' : activity.color,
          }}
        >
          {doneToday ? '✓' : '+'}
        </button>
      }
    >
      {compact ? (
        <WeekStrip
          color={activity.color}
          amounts={amounts}
          today={today}
          onToggleDay={activity.archived ? undefined : onToggleDay}
        />
      ) : (
        <div className="mt-3" ref={strip}>
          <HeatGrid
            color={activity.color}
            amounts={amounts}
            today={today}
            weeks={weeks}
            // Days only: a duration target is milliseconds, which no column of squares can score.
            weeklyTarget={
              activity.measure === 'count' ? (targetAt(activity, 'week') ?? undefined) : undefined
            }
            onDayActivate={activity.archived ? undefined : onToggleDay}
          />
        </div>
      )}
    </CardShell>
  )
}

/**
 * A timed activity: start/pause and stop, with a live elapsed reading, and nothing else.
 *
 * **No heat strip.** A contribution graph answers "on which days did this happen", which is the
 * whole story for a check-off and a discarded one for a timer: a square is on or off, so twenty
 * minutes and six hours would look identical. The card stays a compact row and the history goes
 * where magnitude survives — the list in its own sheet, the Today timeline, and the Insights
 * trend. It is also why
 * this card is shorter than a check-off card, which the grid's `items-start` allows for.
 *
 * The reading is the session and the day — see `TimerReading`. The card says nothing about the
 * **block** (the run from Start to Stop that survives every pause); the block is still what the
 * Stop button ends, and so still what tells that button apart from Pause.
 */
export function DurationCard({
  startedAt,
  todayTotal,
  inBlock,
  onStart,
  onPause,
  onStop,
  ...shared
}: Shared & {
  /** Present exactly when the activity is running: when the current session began. */
  startedAt?: number
  /** Time logged against this activity today, the running session included. */
  todayTotal: number
  /** Whether a block is open at all — false once stopped, and before the first start. */
  inBlock: boolean
  onStart: () => void
  onPause: () => void
  onStop: () => void
}) {
  const { activity } = shared
  const running = startedAt !== undefined

  return (
    <CardShell
      {...shared}
      tinted={running}
      summary={<TimerReading startedAt={startedAt} todayTotal={todayTotal} />}
      action={
        <>
          <IconButton
            label={`${running ? 'Pause' : inBlock ? 'Resume' : 'Start'} ${activity.name}`}
            variant="quiet"
            aria-pressed={running}
            onClick={running ? onPause : onStart}
          >
            {running ? <Pause className="size-5" /> : <Play className="size-5" />}
          </IconButton>

          {/* Stopping is rarer than pausing and it ends something, so it gets a target the
              same size and a surface it does not have. Present but invisible when there is
              no block to end: reserving the slot is what stops the name's width — and so
              whether it truncates — changing under the thumb that just started the timer. */}
          <IconButton
            label={`Stop ${activity.name}`}
            onClick={onStop}
            disabled={!inBlock}
            className={inBlock ? '' : 'invisible'}
          >
            <Square className="size-4" />
          </IconButton>
        </>
      }
    />
  )
}
