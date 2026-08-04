import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  X,
} from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  isOpen,
  tracksCompletion,
  tracksTime,
  type Activity,
  type DateKey,
  type Entry,
} from '../data/types.ts'
import { targetAt } from '../lib/accounting/goals.ts'
import { formatAmount, formatDuration, formatElapsed, formatTime } from '../lib/format.ts'
import { useNow } from '../lib/useNow.ts'
import EntryForm from './EntryForm.tsx'
import { blankDraft, draftFrom, type Draft } from './entryDraft.ts'
import { HeatGrid } from './HeatGrid.tsx'
import Button, { IconButton } from './ui/Button.tsx'
import Stat from './ui/Stat.tsx'

/** A full year of columns. The strip scrolls, so a narrow drawer still shows all of it. */
const SHEET_WEEKS = 53

/** Stretches the sheet lists. Enough to cover the recent past without becoming an archive. */
export const SHEET_ENTRIES = 30

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
  entries,
  timedActivities,
  today,
  now,
  thisPeriod,
  streak,
  longest,
  total,
  trackedTime,
  startedAt,
  blockBefore,
  inBlock,
  onDayActivate,
  onStart,
  onPause,
  onStop,
  onResume,
  onEdit,
  onArchive,
  onMoveEarlier,
  onMoveLater,
  onDelete,
  onClose,
}: {
  activity: Activity
  amounts: Map<DateKey, number>
  /**
   * This activity's own stretches, newest first and already capped. Empty for a plain check-off;
   * a hybrid one that also runs a timer has its timed stretches here.
   */
  entries: Entry[]
  /**
   * Every timed activity, for the entry form's own picker — which is what still allows an entry
   * to be moved to a different activity. Doing so makes the row leave this list, correctly.
   */
  timedActivities: Activity[]
  today: DateKey
  now: number
  /** Progress inside the current period of the activity's own target. */
  thisPeriod: number
  streak: number
  longest: number
  total: number
  /** Time tracked over the horizon — shown beside a hybrid check-off's entry list. */
  trackedTime: number
  startedAt?: number
  blockBefore: number
  inBlock: boolean
  onDayActivate: (day: DateKey) => void
  onStart: () => void
  onPause: () => void
  onStop: () => void
  /**
   * Take back the stop that ended the last block. Present only when there is one to take back and
   * the activity is not already running.
   */
  onResume?: () => void
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
  // A hybrid shows both axes; a plain activity shows only its own. `timed` still governs how the
  // primary total reads, `canTime`/`canCheck` govern which secondary blocks appear.
  const canTime = tracksTime(activity)
  const canCheck = tracksCompletion(activity)

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
          closing it first. A hybrid check-off gets them as well — this is where its time is
          logged, since its dashboard card stays a plain check-off. */}
      {canTime && !activity.archived && (
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

          {/* Taking back a stop is the one mistake no amount of editing entries can undo, because
              what a stop ends is the *block*, which no entry records. It sits beside the controls
              rather than on a row: it was only ever attached to one in the Log because that screen
              had no per-activity control area to put it in. */}
          {onResume && (
            <Button variant="quiet" className="shrink-0 px-3 text-xs" onClick={onResume}>
              <RotateCcw className="size-3.5" aria-hidden />
              Resume
            </Button>
          )}
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

      {/* How history is drawn is where the two axes part. A check-off gets the contribution grid;
          a timer gets its stretches as a list, because a square that is merely on or off throws
          away the quantity. A hybrid gets both, its primary axis first. */}
      {activity.measure === 'count' ? (
        <>
          <HistoryGrid
            activity={activity}
            amounts={amounts}
            today={today}
            weeklyTarget={weeklyTarget ?? undefined}
            heading="Past year"
            onDayActivate={onDayActivate}
          />
          {canTime && (
            <EntryList
              activity={activity}
              entries={entries}
              timedActivities={timedActivities}
              trackedTime={trackedTime}
              now={now}
            />
          )}
        </>
      ) : (
        <>
          <EntryList
            activity={activity}
            entries={entries}
            timedActivities={timedActivities}
            now={now}
          />
          {canCheck && (
            // No weekly target here: a hybrid timer's goal is in hours, which the days grid has
            // nothing to score against — the squares are pure presence.
            <HistoryGrid
              activity={activity}
              amounts={amounts}
              today={today}
              heading="Checked off"
              onDayActivate={onDayActivate}
            />
          )}
        </>
      )}

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
        {/* The only route to a delete. A destructive action gets a deliberate, labelled
            button, not a gesture the card can misread. */}
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  )
}

/**
 * The contribution grid, and the note that its squares are editable.
 *
 * Shared by a check-off's "Past year" and a hybrid timer's "Checked off": the same grid, the same
 * tap-to-fill, differing only in heading and whether a weekly target shades the columns.
 */
function HistoryGrid({
  activity,
  amounts,
  today,
  weeklyTarget,
  heading,
  onDayActivate,
}: {
  activity: Activity
  amounts: Map<DateKey, number>
  today: DateKey
  weeklyTarget?: number
  heading: string
  onDayActivate: (day: DateKey) => void
}) {
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-medium text-ink-muted">{heading}</h3>
      <HeatGrid
        color={activity.color}
        amounts={amounts}
        today={today}
        weeks={SHEET_WEEKS}
        weeklyTarget={weeklyTarget}
        onDayActivate={activity.archived ? undefined : onDayActivate}
      />
      <p className="mt-2 text-2xs text-ink-muted">Tap any past day to fill it in or clear it.</p>
    </div>
  )
}

/**
 * One timed activity's recorded stretches, newest first — and the place they get corrected.
 *
 * This is what the Log screen used to be, narrowed to one activity. What that screen could do and
 * this cannot is show a past day across *every* activity at once; Today still does it for today,
 * and Insights' breakdown gives per-activity totals for a period.
 *
 * A plain reverse-chronological list rather than the Log's week stepper: a sheet is a glance, not
 * an archive, and browsing arbitrary weeks of one activity is what the Insights trend is for.
 *
 * ponytail: capped at `SHEET_ENTRIES`, sliced from the year the dashboard already read — so this
 * costs no query of its own. Ceiling: a stretch older than that year, or older than the newest
 * thirty, is not reachable here. The same bound already governs the streak and the total beside
 * it. Upgrade path is a paged read on the `[activityId+endedAt]` index.
 */
function EntryList({
  activity,
  entries,
  timedActivities,
  trackedTime,
  now,
}: {
  activity: Activity
  entries: Entry[]
  timedActivities: Activity[]
  /** Time over the horizon, shown in the header when this list is a hybrid's secondary axis. */
  trackedTime?: number
  now: number
}) {
  // Owned here rather than passed in: the sheet unmounts when it closes, which is what resets a
  // half-typed correction, and no other screen needs to know an entry is being edited.
  const [draft, setDraft] = useState<Draft | null>(null)

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="flex-1 text-sm font-medium text-ink-muted">
          Recent
          {trackedTime !== undefined && trackedTime > 0 && (
            <span className="text-ink-soft tabular-nums"> · {formatDuration(trackedTime)}</span>
          )}
        </h3>
        {!activity.archived && (
          <Button
            variant="quiet"
            className="min-h-9 px-3 text-xs"
            onClick={() => setDraft({ ...blankDraft(now), activityId: activity.id })}
          >
            <Plus className="size-3.5" aria-hidden />
            Add time
          </Button>
        )}
      </div>

      {/* Only a new entry belongs up here. An edit belongs under the row it corrects, because a
          form floating above a list of rows never said which of them it was about. */}
      {draft && !draft.id && (
        <EntryForm
          className="panel mb-3 p-4"
          draft={draft}
          activities={timedActivities}
          onChange={setDraft}
          onClose={() => setDraft(null)}
        />
      )}

      {entries.length === 0 && !draft && (
        <p className="text-sm text-ink-muted">
          Nothing recorded yet. Start the timer above, or write down a stretch it missed.
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            now={now}
            // A second tap on the open row closes it again, the way the chevron says it should.
            onEdit={() => setDraft(draft?.id === entry.id ? null : draftFrom(entry))}
            form={
              draft?.id === entry.id ? (
                <EntryForm
                  className="panel p-4"
                  draft={draft}
                  activities={timedActivities}
                  onChange={setDraft}
                  onClose={() => setDraft(null)}
                />
              ) : undefined
            }
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * One stretch as a row: when it ran, for how long, and its note.
 *
 * No colour dot and no activity name, unlike the Log's version of this row — inside one activity's
 * sheet both would be the same on every row. The date takes their place, since the list is not
 * grouped by day.
 */
function EntryRow({
  entry,
  now,
  onEdit,
  form,
}: {
  entry: Entry
  now: number
  onEdit: () => void
  /** This row's edit form, when it is the row being edited. */
  form?: ReactNode
}) {
  const running = isOpen(entry)
  const editing = form !== undefined

  return (
    <li className="flex flex-col gap-1.5">
      {/* Nearly the whole row is the tap target: on a phone a row of small action buttons is
          harder to hit than the row itself, and editing is what almost every row does. The
          chevron is there because nothing else said so; it turns down when the form opens. */}
      <button
        type="button"
        onClick={onEdit}
        aria-expanded={editing}
        className={`focus-ring panel group flex min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-raised ${
          editing ? 'bg-raised' : ''
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="shrink-0 text-xs text-ink-muted">{rowDate(entry.startedAt)}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink tabular-nums">
              {formatTime(entry.startedAt)} –{' '}
              {running ? <span className="text-accent-ink">now</span> : formatTime(entry.endedAt)}
            </span>
          </span>
          {entry.note && (
            <span className="mt-0.5 block truncate text-xs text-ink-soft">{entry.note}</span>
          )}
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

      {form}
    </li>
  )
}

const rowDate = (at: number) =>
  new Date(at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

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
