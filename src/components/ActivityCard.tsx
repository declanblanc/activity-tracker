import { Pause, Play, Square } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { Activity, DateKey } from '../data/types.ts'
import { targetAt } from '../lib/accounting/goals.ts'
import { formatAmount, formatDuration, formatElapsed, formatTime } from '../lib/format.ts'
import { weeksThatFit } from '../lib/heatStrip.ts'
import { useNow } from '../lib/useNow.ts'
import { HeatGrid } from './HeatGrid.tsx'
import SwipeToDelete from './SwipeToDelete.tsx'
import { IconButton } from './ui/Button.tsx'

/**
 * The dashboard's cards. Two components rather than one with a branch, over a shared shell,
 * a shared heat strip and a shared swipe gesture.
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
 * asks for what fits and nothing more — which is also what keeps a horizontally-scrolling
 * strip out of a horizontally-swiping card.
 */
function useFittingWeeks(max: number) {
  const strip = useRef<HTMLDivElement>(null)
  const [weeks, setWeeks] = useState(max)

  useEffect(() => {
    const element = strip.current
    if (!element) return

    const measure = () => setWeeks(Math.min(max, weeksThatFit(element.clientWidth)))
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [max])

  return [strip, weeks] as const
}

type Shared = {
  activity: Activity
  /** day → amount, from `dayAmounts`. */
  amounts: Map<DateKey, number>
  today: DateKey
  onOpen: () => void
  onDelete: () => void
  onDayActivate: (day: DateKey) => void
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

/** The card shell: surface, identity block, and the strip. Both measures share it. */
function CardShell({
  activity,
  amounts,
  today,
  onOpen,
  onDelete,
  onDayActivate,
  summary,
  tinted = false,
  action,
}: Shared & { summary: ReactNode; tinted?: boolean; action: ReactNode }) {
  const [strip, weeks] = useFittingWeeks(CARD_MAX_WEEKS)
  const interactive = !activity.archived

  return (
    <SwipeToDelete
      onDelete={onDelete}
      className={`panel p-4 ${tinted ? 'activity-tint activity-rail' : ''} ${
        activity.archived ? 'opacity-50' : ''
      }`}
    >
      {/* The activity's colour reaches the card through one custom property, and only as a
          tint, a rail and a dot — never under text. See `activity-tint` in index.css. */}
      <div style={{ '--activity': activity.color } as CSSProperties}>
        <div className="flex items-start gap-3">
          {/* The title block is the affordance for the detail sheet, rather than the whole
              card — a card-wide click would fight every square in the grid below. */}
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
          {interactive && action}
        </div>

        <div className="mt-3" ref={strip}>
          <HeatGrid
            activity={activity}
            amounts={amounts}
            today={today}
            weeks={weeks}
            onDayActivate={interactive ? onDayActivate : undefined}
          />
        </div>
      </div>
    </SwipeToDelete>
  )
}

/**
 * A check-off activity: one round toggle for today, and a strip whose squares toggle any past
 * day. Backfilling a missed day is just clicking an older square.
 */
export function CountCard({
  thisWeek,
  streak,
  total,
  onToggleToday,
  ...shared
}: Shared & {
  /** Check-offs so far this week, for a weekly goal's progress line. */
  thisWeek: number
  streak: number
  total: number
  onToggleToday: () => void
}) {
  const { activity, amounts, today } = shared
  const doneToday = (amounts.get(today) ?? 0) > 0

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
    />
  )
}

/**
 * A timed activity: start/pause and stop, with a live elapsed reading.
 *
 * The number on the card is its **block**: the run from the moment the timer was started to
 * the moment it is stopped, carried across any number of pauses. Pausing for lunch leaves it
 * counting on from 3h rather than resetting; stopping ends the block, so the next start begins
 * a fresh one at zero. Both write exactly the same thing, a closed entry — only the block
 * boundary tells them apart, which is why it lives in `prefs`.
 *
 * A square on the strip opens the entry form for that day: a stretch of time cannot be
 * "ticked" the way a check-off can.
 */
export function DurationCard({
  startedAt,
  blockBefore,
  inBlock,
  todayTotal,
  thisWeek,
  streak,
  total,
  onStart,
  onPause,
  onStop,
  ...shared
}: Shared & {
  /** Present exactly when the activity is running. */
  startedAt?: number
  /**
   * Tracked time in the current block, pauses excluded and **not** counting the stretch that
   * is running right now.
   *
   * Excluding it is what lets the card tick once a second on its own: it adds `now -
   * startedAt` itself, so the reading advances between the screen's slower refreshes instead
   * of freezing between them. When nothing is running this is the whole block.
   */
  blockBefore: number
  /** Whether a block is open at all — false once stopped, and before the first start. */
  inBlock: boolean
  /** Tracked time against this activity today, which is what an idle card reports. */
  todayTotal: number
  thisWeek: number
  streak: number
  total: number
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
      summary={
        <DurationSummary
          activity={activity}
          startedAt={startedAt}
          blockBefore={blockBefore}
          inBlock={inBlock}
          todayTotal={todayTotal}
          thisWeek={thisWeek}
          streak={streak}
          total={total}
        />
      }
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

/**
 * The live half of a timed card's summary line.
 *
 * A component for exactly one reason: it owns the once-a-second tick. Hoisting that to the
 * screen would re-render every card on the dashboard every second, most of them check-off
 * cards with nothing on them that moves.
 */
function DurationSummary({
  activity,
  startedAt,
  blockBefore,
  inBlock,
  todayTotal,
  thisWeek,
  streak,
  total,
}: {
  activity: Activity
  startedAt?: number
  blockBefore: number
  inBlock: boolean
  todayTotal: number
  thisWeek: number
  streak: number
  total: number
}) {
  const now = useNow(1000)

  if (startedAt !== undefined) {
    // The running stretch is measured here rather than handed in, so the reading advances on
    // this component's own tick instead of freezing until the screen next refreshes.
    return `${formatElapsed(blockBefore + (now - startedAt))} since ${formatTime(startedAt)}`
  }
  if (inBlock) return `${formatDuration(blockBefore)} so far, paused`
  if (targetAt(activity, 'week') !== null || streak > 0) {
    return goalSummary(activity, thisWeek, streak, total)
  }
  return todayTotal > 0 ? `${formatDuration(todayTotal)} today` : 'Not started today'
}
