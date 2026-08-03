import { BarChart3, ChevronLeft, ChevronRight, Pause, Play, Square, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import type { Activity, DateKey } from '../data/types.ts'
import { targetAt } from '../lib/accounting/goals.ts'
import { formatAmount, formatDuration, formatElapsed, formatTime } from '../lib/format.ts'
import { useNow } from '../lib/useNow.ts'
import { HeatGrid } from './HeatGrid.tsx'
import Button, { IconButton } from './ui/Button.tsx'
import Stat from './ui/Stat.tsx'

/** A full year of columns. The strip scrolls, so a narrow drawer still shows all of it. */
const SHEET_WEEKS = 53

/**
 * Everything about one activity, and everything you can do to it other than run it from the
 * dashboard: the year grid, the streaks, edit, reorder, archive, delete.
 *
 * One component with a branch, unlike the cards — and the asymmetry is deliberate. On a card
 * the measure-specific part is most of the interactive surface; here it is one block among six,
 * so splitting would duplicate sixty lines to vary fifteen.
 *
 * The sheet, not a route, wins the tap on a card's title: it opens over the grid with no route
 * change and no chart bundle to fetch. It carries a link to the focused Insights view for the
 * things that genuinely need one — the trend, the deltas, the period stepper — and stays cheap
 * itself.
 */
export default function ActivitySheet({
  activity,
  amounts,
  today,
  thisPeriod,
  streak,
  longest,
  total,
  startedAt,
  blockBefore,
  inBlock,
  onDayActivate,
  onStart,
  onPause,
  onStop,
  onEdit,
  onArchive,
  onMoveEarlier,
  onMoveLater,
  onDelete,
  onClose,
}: {
  activity: Activity
  amounts: Map<DateKey, number>
  today: DateKey
  /** Progress inside the current period of the activity's own target. */
  thisPeriod: number
  streak: number
  longest: number
  total: number
  startedAt?: number
  blockBefore: number
  inBlock: boolean
  onDayActivate: (day: DateKey) => void
  onStart: () => void
  onPause: () => void
  onStop: () => void
  onEdit: () => void
  onArchive: () => void
  onMoveEarlier?: () => void
  onMoveLater?: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const weeklyTarget = targetAt(activity, 'week')
  // A streak is counted in whichever period the activity is scored by; the total is always
  // days for a check-off and time for a timer.
  const streakUnit = activity.targetPeriod === 'week' ? 'weeks' : 'days'
  const timed = activity.measure === 'duration'

  return (
    <div
      style={{ '--activity': activity.color } as CSSProperties}
      className="flex min-h-full flex-col bg-surface p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
          style={{ backgroundColor: activity.color }}
        >
          {activity.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold break-words text-ink">{activity.name}</h2>
          {activity.description && (
            <p className="mt-0.5 text-sm text-ink-muted">{activity.description}</p>
          )}
        </div>
        <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-1 size-9">
          <X className="size-5" />
        </IconButton>
      </div>

      <GoalLine activity={activity} thisPeriod={thisPeriod} weeklyTarget={weeklyTarget} />

      {/* Running controls live here too, so a timer can be started from the sheet without
          closing it first. */}
      {timed && !activity.archived && (
        <div className="mt-4 flex items-center gap-2">
          <IconButton
            label={`${startedAt !== undefined ? 'Pause' : inBlock ? 'Resume' : 'Start'} ${activity.name}`}
            variant="quiet"
            aria-pressed={startedAt !== undefined}
            onClick={startedAt !== undefined ? onPause : onStart}
          >
            {startedAt !== undefined ? <Pause className="size-5" /> : <Play className="size-5" />}
          </IconButton>
          <IconButton
            label={`Stop ${activity.name}`}
            onClick={onStop}
            disabled={!inBlock}
            className={inBlock ? '' : 'invisible'}
          >
            <Square className="size-4" />
          </IconButton>
          <p className="min-w-0 flex-1 truncate text-sm tabular-nums text-ink-soft">
            <BlockReading startedAt={startedAt} blockBefore={blockBefore} inBlock={inBlock} />
          </p>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="Current" value={streak} unit={streakUnit} />
        <Stat label="Longest" value={longest} unit={streakUnit} />
        <Stat
          label="Total"
          value={timed ? formatDuration(total) : total}
          unit={timed ? undefined : 'days'}
        />
      </dl>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-medium text-ink-muted">Past year</h3>
        <HeatGrid
          activity={activity}
          amounts={amounts}
          today={today}
          weeks={SHEET_WEEKS}
          onDayActivate={activity.archived ? undefined : onDayActivate}
        />
        <p className="mt-2 text-2xs text-ink-muted">
          {timed
            ? 'Tap a day to add or correct time on it.'
            : 'Tap any past day to fill it in or clear it.'}
        </p>
      </div>

      <div className="mt-6">
        <Link
          to={`/insights?activity=${activity.id}`}
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-accent-ink"
        >
          <BarChart3 className="size-4" />
          View insights
        </Link>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-8">
        <Button variant="quiet" onClick={onEdit}>
          Edit
        </Button>

        {/* "Earlier" and "later", not up and down: the dashboard is an auto-filling grid, so
            on a three-column layout "up" moves a card left. Order is linear in DOM order,
            which makes earlier/later the only axis that is true at every width. */}
        <IconButton
          label={`Move ${activity.name} earlier`}
          variant="quiet"
          onClick={onMoveEarlier}
          disabled={!onMoveEarlier}
        >
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton
          label={`Move ${activity.name} later`}
          variant="quiet"
          onClick={onMoveLater}
          disabled={!onMoveLater}
        >
          <ChevronRight className="size-4" />
        </IconButton>

        <Button variant="quiet" onClick={onArchive} className="ml-auto">
          {activity.archived ? 'Unarchive' : 'Archive'}
        </Button>
        {/* Also the only keyboard- and desktop-reachable delete: the swipe gesture on the card
            is a shortcut, never the sole route to a destructive action. */}
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  )
}

/** What the activity is aiming for, and how far into the current period it is. */
function GoalLine({
  activity,
  thisPeriod,
  weeklyTarget,
}: {
  activity: Activity
  thisPeriod: number
  weeklyTarget: number | null
}) {
  const target = activity.targetAmount
  if (!target || !activity.targetPeriod) return null

  const goal = formatAmount(activity.measure, target)
  const so_far = formatAmount(activity.measure, thisPeriod)
  const per = activity.targetPeriod === 'day' ? 'a day' : `a ${activity.targetPeriod}`

  return (
    <p className="mt-4 text-sm text-ink-muted">
      Goal: {goal} {per}
      {weeklyTarget !== null && ` — ${so_far} so far this week`}
      {activity.targetPeriod === 'month' && ` — ${so_far} so far this month`}.
    </p>
  )
}

/** The sheet's own live timer reading, on its own tick for the same reason the card's is. */
function BlockReading({
  startedAt,
  blockBefore,
  inBlock,
}: {
  startedAt?: number
  blockBefore: number
  inBlock: boolean
}) {
  const now = useNow(1000)
  if (startedAt !== undefined) {
    return `${formatElapsed(blockBefore + (now - startedAt))} since ${formatTime(startedAt)}`
  }
  if (inBlock) return `${formatDuration(blockBefore)} so far, paused`
  return 'Not running'
}
