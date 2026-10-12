import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowUpDown, LayoutGrid, Plus, Rows3 } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import ActivityForm from '../components/ActivityForm.tsx'
import { blankDraft, draftFrom, toInput, type Draft } from '../components/activityDraft.ts'
import { CountCard, DurationCard } from '../components/ActivityCard.tsx'
import ActivitySheet, { SHEET_ENTRIES } from '../components/ActivitySheet.tsx'
import SyncStatus from '../components/SyncStatus.tsx'
import Button from '../components/ui/Button.tsx'
import EmptyState from '../components/ui/EmptyState.tsx'
import { Modal } from '../components/ui/Modal.tsx'
import Toast from '../components/ui/Toast.tsx'
import {
  getActivities,
  reorderActivities,
  saveActivity,
  softDeleteActivity,
} from '../data/activities.ts'
import { getCompletions, setCompletion } from '../data/completions.ts'
import {
  getEntriesInRange,
  getOpenEntries,
  MIN_TRACKED_MS,
  startActivity,
  stopActivity,
} from '../data/entries.ts'
import { getPref, setActivityStamp, setPref } from '../data/prefs.ts'
import {
  OPEN_ENTRY_END,
  displayMode,
  type Activity,
  type Completion,
  type DateKey,
  type Entry,
  type Period,
} from '../data/types.ts'
import { streaks, targetAt } from '../lib/accounting/goals.ts'
import { periodTotals, totalSince } from '../lib/accounting/totals.ts'
import { completionAmounts, dayAmounts, periodAmounts, trackedByDay } from '../lib/days.ts'
import { formatDuration } from '../lib/format.ts'
import { nextColor } from '../lib/palette.ts'
import { dayWindow, dayWindowsIn, formatKey, periodWindow, trailingWindows } from '../lib/time.ts'
import { useNow } from '../lib/useNow.ts'
import { useToday } from '../lib/useToday.ts'

/** How long a toast stays up. */
const TOAST_FOR = 6000

/**
 * How far back the dashboard reads, in weeks. A year, which is what the detail sheet draws.
 *
 * ponytail: one read of a year of entries on every open, with every strip, streak and total
 * derived from a single pass over it. Ceiling: a streak longer than a year reads as a year, and
 * a timed activity's "total" is a year's total rather than an all-time one. Check-off totals are
 * genuinely all-time, because completions are read whole. Upgrade path if either bites: a
 * per-day rollup table written on each stop, keyed `[activityId+day]`.
 */
const HISTORY_WEEKS = 53

/** Periods of lookback when scoring a streak, by the period the target is set at. */
const STREAK_PERIODS: Record<Period, number> = {
  day: HISTORY_WEEKS * 7,
  week: HISTORY_WEEKS,
  month: 12,
}

/**
 * The dashboard: every activity as a card, whichever way it is tracked.
 *
 * A check-off card carries one round toggle for today; a timed card carries start/pause and
 * stop over a live readout. They share a shell, so they share one list in the owner's own order,
 * and differ in the body: a habit card's history grid, a timer card's clock.
 *
 * Three clocks, deliberately. `useToday` names the day, and re-samples at midnight so a PWA
 * left open overnight does not log to yesterday. `useNow(30s)` refreshes the day summary. The
 * once-a-second tick a running timer needs lives inside the card that is running, because
 * hoisting it here would re-render every card every second.
 */
export default function Activities() {
  const today = useToday()
  const now = useNow(30_000)
  const activities = useLiveQuery(() => getActivities(true), [])
  const openEntries = useLiveQuery(() => getOpenEntries(), [])
  const completions = useLiveQuery(() => getCompletions(), [])

  // Mirrored in component state because `prefs` is a plain read: this is the only screen that
  // opens and closes blocks, so a store to make them reactive across screens would buy nothing.
  const [blockStartedAt, setBlockStartedAt] = useState(() => getPref('blockStartedAt'))
  // Read as well as written now that the sheet offers Resume, so it is mirrored the same way.
  const [resumable, setResumable] = useState(() => getPref('resumableBlockStartedAt'))

  const day = dayWindow(now)
  const horizon = trailingWindows(now, 'week', HISTORY_WEEKS)
  // One read for the whole screen. Nothing in a block predates the moment it opened, so the
  // earliest open block bounds them all; a running card whose block was lost to cleared storage
  // falls back to its own stretch, so those count too.
  const readStart = Math.min(
    horizon[0].start,
    day.start,
    ...Object.values(blockStartedAt),
    ...(openEntries ?? []).map((entry) => entry.startedAt),
  )
  const entries = useLiveQuery(
    // `OPEN_ENTRY_END` as the upper bound so open entries, whose `endedAt` *is* the sentinel,
    // are inside the range rather than past it.
    () => getEntriesInRange(readStart, OPEN_ENTRY_END),
    [readStart],
  )

  const [draft, setDraft] = useState<{ draft: Draft; id?: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  // Reorder mode: a card only becomes a drag handle here, so an everyday tap on a timer or a
  // check-off is never mistaken for the start of a drag.
  const [editing, setEditing] = useState(false)
  // Device setting, mirrored like the block markers: this is the only screen that reads it, so a
  // reactive store would buy nothing.
  const [compact, setCompact] = useState(() => getPref('compactActivities'))
  // A deadline rather than a timer: `now` already ticks this screen, so it can retire the toast
  // too, and there is no interval to own or clean up.
  const [toast, setToast] = useState<{
    message: string
    until: number
    action?: { label: string; onAction: () => void }
  } | null>(null)

  if (!activities || !openEntries || !entries || !completions) return null

  const visible = showArchived ? activities : activities.filter((activity) => !activity.archived)
  const archivedCount = activities.filter((activity) => activity.archived).length
  const startedAtByActivity = new Map(
    openEntries.map((entry) => [entry.activityId, entry.startedAt]),
  )

  const dayTotals = periodTotals(entries, day, now)

  /** Everything a card or the sheet needs to say about one activity. */
  const summarise = (activity: Activity) =>
    summariseActivity(activity, entries, completions, horizon, now)

  /** Open or close an activity's block. `at` of `undefined` closes it. */
  const setBlockStart = (activityId: string, at?: number) => {
    setBlockStartedAt(setActivityStamp('blockStartedAt', activityId, at))
  }

  /**
   * Open a timer, either resuming the block it is already in or beginning a new one.
   *
   * The block is anchored on the entry's own `startedAt` rather than on the clock, so a double
   * tap that lands on the same open entry anchors to that entry either way.
   */
  const startOrResume = async (activityId: string) => {
    const resuming = blockStartedAt[activityId] !== undefined
    const entry = await startActivity(activityId)
    if (!resuming) {
      setBlockStart(activityId, entry.startedAt)
      // A new block discards the stopped one the sheet could have offered back: once time is
      // being tracked against a fresh block, the old one is history.
      setResumable(setActivityStamp('resumableBlockStartedAt', activityId, undefined))
    }
  }

  /**
   * Say that a stretch was too short to keep. Halting a timer is the one action here with an
   * outcome the screen would not otherwise show — the card just goes quiet — so it is the one
   * that has to be reported.
   */
  const reportDiscarded = (activityId: string) => {
    const name = activities.find((activity) => activity.id === activityId)?.name ?? 'That timer'
    setToast({
      message: `${name} ran under ${MIN_TRACKED_MS / 1000} seconds, so it was not logged.`,
      until: Date.now() + TOAST_FOR,
    })
  }

  // Both close the entry. Stopping also ends the block, which is what makes the next start
  // begin a fresh timer instead of carrying the old total forward.
  const pause = async (activityId: string) => {
    const { discarded } = await stopActivity(activityId)
    if (discarded) reportDiscarded(activityId)
  }

  /**
   * End the block as well as the entry, filing where it began so the sheet can put it back.
   * Stopping is otherwise the one action here that loses something no entry records.
   */
  const stop = async (activityId: string) => {
    const blockStart = blockStartedAt[activityId] ?? startedAtByActivity.get(activityId)
    const { discarded } = await stopActivity(activityId)
    setBlockStart(activityId, undefined)
    if (blockStart !== undefined) {
      setResumable(setActivityStamp('resumableBlockStartedAt', activityId, blockStart))
    }
    if (discarded) reportDiscarded(activityId)
  }

  /**
   * Take back the stop that ended this block: restore where it began, and open a stretch to carry
   * it on.
   *
   * The new stretch starts now rather than at the stop, which leaves a gap for however long the
   * mistake went unnoticed. That is the honest direction to be wrong in — the alternative invents
   * tracked time — and the gap is one entry edit away from being fixed, in the same sheet.
   */
  const resume = async (activityId: string) => {
    const blockStart = resumable[activityId]
    await startActivity(activityId)
    setBlockStart(activityId, blockStart)
    setResumable(setActivityStamp('resumableBlockStartedAt', activityId, undefined))
  }

  /**
   * Delete straight away and offer the way back, rather than asking first.
   *
   * The record is only tombstoned, so undo is one field — which means there is no pending
   * state to reconcile if the toast is missed.
   */
  const remove = async (activity: Activity) => {
    await softDeleteActivity(activity.id)
    setOpenId(null)
    setToast({
      message: `Deleted “${activity.name}”`,
      until: Date.now() + TOAST_FOR,
      action: {
        label: 'Undo',
        onAction: () => {
          void saveActivity({ ...activity, archived: activity.archived })
          setToast(null)
        },
      },
    })
  }

  /**
   * Fill a day in or clear it, and say why when it cannot be cleared.
   *
   * Returns the reason the day was left alone, or `undefined` when it was written. Time now
   * checks a day off outright (see `completionAmounts`), so a `done: false` row written over a
   * tracked day would be a decision the grid never honours: the square would stay filled and the
   * tap would read as broken. The tap is answered with the reason and the way out — deleting the
   * time — instead.
   *
   * The rule lives here and the wording travels, because the two surfaces that offer the tap
   * cannot show a message the same way: the sheet is a native `<dialog>` in the top layer, so a
   * docked toast fired from inside it would be painted underneath.
   *
   * Set, not toggle: a day the timer ran on shows as checked off with no row to flip, so what is
   * inverted is the state on screen, not the state in storage.
   */
  const toggleDay = (
    activity: Activity,
    stats: ActivityStats,
    dayKey: DateKey,
  ): string | undefined => {
    const tracked = stats.trackedDays.get(dayKey) ?? 0
    if (tracked > 0) {
      const when = dayKey === today ? 'Today' : formatKey(dayKey)
      return (
        `${when} is checked off because ${formatDuration(tracked)} of “${activity.name}” ` +
        'is tracked on it. Delete that time to clear the day.'
      )
    }

    void setCompletion(activity.id, dayKey, !checked(stats, dayKey))
    return undefined
  }

  /** The card's rendering of a refused tap: a toast, with the way to the time that caused it. */
  const toggleDayFromCard = (activity: Activity, stats: ActivityStats, dayKey: DateKey) => {
    const refused = toggleDay(activity, stats, dayKey)
    if (!refused) return
    setToast({
      message: refused,
      until: Date.now() + TOAST_FOR,
      // A card does not show its stretches; the sheet lists them, and is where one is deleted.
      action: { label: 'Show time', onAction: () => setOpenId(activity.id) },
    })
  }

  /**
   * Move the activity at `index` of the visible list `by` slots and write the whole order back.
   * Hidden activities keep the slots they already hold, so a move never steps over an activity
   * the owner cannot see.
   */
  const move = (index: number, by: number) => {
    const reordered = [...visible]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(index + by, 0, moved)

    const visibleIds = new Set(visible.map((activity) => activity.id))
    let next = 0
    const order = activities.map((activity) =>
      visibleIds.has(activity.id) ? reordered[next++].id : activity.id,
    )
    return reorderActivities(order)
  }

  const openActivity = activities.find((activity) => activity.id === openId)
  const openIndex = visible.findIndex((activity) => activity.id === openId)

  // Never leave a card stuck as a drag handle: if the list shrinks to one while editing, the
  // Reorder toggle is gone, so reorder mode has to switch itself off or that card is uninteractable.
  const reordering = editing && visible.length > 1

  /** One card, chosen by the activity's display mode. */
  const renderCard = (activity: Activity): ReactNode => {
    const stats = summarise(activity)
    const startedAt = startedAtByActivity.get(activity.id)
    // A running card with no recorded block treats its own stretch as one, so a timer left open
    // across cleared storage still reads sensibly.
    const blockStart = blockStartedAt[activity.id] ?? startedAt
    const shared = { activity, onOpen: () => setOpenId(activity.id) }

    return displayMode(activity) === 'habit' ? (
      <CountCard
        {...shared}
        // The check-offs, not the scored amounts: a habit card whose goal is scored on time would
        // otherwise fill its squares from milliseconds. Same series the sheet's grid draws.
        amounts={stats.gridAmounts}
        today={today}
        // Any activity's timer can be running, started from its own sheet — the habit card is
        // the one that has no control saying so.
        running={startedAt !== undefined}
        compact={compact}
        onToggleDay={(dayKey) => toggleDayFromCard(activity, stats, dayKey)}
        thisWeek={stats.thisWeek}
        streak={stats.streak}
        total={stats.total}
        onToggleToday={() => toggleDayFromCard(activity, stats, today)}
        onStop={() => void stop(activity.id)}
      />
    ) : (
      <DurationCard
        {...shared}
        thisWeek={stats.thisWeek}
        streak={stats.streak}
        total={stats.total}
        startedAt={startedAt}
        todayTotal={dayTotals.perActivity.get(activity.id) ?? 0}
        inBlock={blockStart !== undefined}
        compact={compact}
        onStart={() => void startOrResume(activity.id)}
        onPause={() => void pause(activity.id)}
        onStop={() => void stop(activity.id)}
      />
    )
  }

  /**
   * Persist the visible cards' new order without disturbing any hidden card.
   *
   * The drag reorders the visible ids; this drops them back into the slots they already held in
   * the global order, leaving archived cards, when they are hidden, exactly where they were. Same
   * move `move()` makes for the up/down buttons.
   */
  const persistOrder = (visibleOrder: string[]) => {
    const shown = new Set(visibleOrder)
    let next = 0
    const order = activities.map((activity) =>
      shown.has(activity.id) ? visibleOrder[next++] : activity.id,
    )
    return reorderActivities(order)
  }

  return (
    <section className="screen-pad mx-auto w-full max-w-3xl lg:max-w-5xl xl:max-w-6xl">
      {/* On a phone the three toolbar buttons are icon-only, so they fit one row beside the title;
          from `sm` up each label appears. The label is `sr-only` rather than removed, so an
          icon-only button still carries its name. `flex-wrap` stays as a backstop. */}
      <header className="flex flex-wrap items-center gap-2">
        {/* Stacked rather than beside the title, so the phone toolbar keeps its one row. */}
        <div>
          <h1 className="text-xl font-semibold text-ink">Activities</h1>
          <SyncStatus />
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* Only worth offering once there is a card whose room it could reclaim: it now
              tightens every card's own padding, not just the check-off strip. */}
          {visible.length > 0 && (
            <Button
              variant="ghost"
              aria-pressed={compact}
              onClick={() => {
                setCompact((on) => {
                  setPref('compactActivities', !on)
                  return !on
                })
              }}
            >
              <Rows3 className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{compact ? 'Expand' : 'Compact'}</span>
            </Button>
          )}
          {/* Nothing to reorder with one card, and the toggle would only be a dead control. */}
          {visible.length > 1 && (
            <Button
              variant="ghost"
              aria-pressed={editing}
              onClick={() => setEditing((on) => !on)}
            >
              <ArrowUpDown className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{editing ? 'Done' : 'Reorder'}</span>
            </Button>
          )}
          {/* Adding an activity happens once a month; logging one happens all day. This is
              deliberately not the loudest thing on the screen. */}
          <Button onClick={() => setDraft({ draft: blankDraft(nextColor(activities.length)) })}>
            <Plus className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Add activity</span>
          </Button>
        </div>
      </header>

      {activities.length === 0 && (
        <EmptyState
          icon={<LayoutGrid className="size-8" />}
          action={
            <Button
              variant="primary"
              onClick={() => setDraft({ draft: blankDraft(nextColor(activities.length)) })}
            >
              Add your first activity
            </Button>
          }
        >
          Nothing to track yet. An activity is either something you check off each day, or a timer
          you flip on and off.
        </EmptyState>
      )}

      {visible.length > 0 && (
        <ActivityGrid
          activities={visible}
          editing={reordering}
          compact={compact}
          onReorder={persistOrder}
          renderCard={renderCard}
        />
      )}

      {archivedCount > 0 && (
        <Button
          variant="ghost"
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
          className="mt-4 w-full"
        >
          {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
        </Button>
      )}

      {toast && toast.until > now && (
        <Toast message={toast.message} action={toast.action} onDismiss={() => setToast(null)} />
      )}

      <Modal
        open={openActivity !== undefined}
        onClose={() => setOpenId(null)}
        label={openActivity ? openActivity.name : 'Activity'}
        // Full-screen sheet on a phone, right-hand drawer from `sm` up — the same component
        // either way, with the difference expressed entirely in CSS.
        className="m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto sm:mr-0 sm:ml-auto sm:w-[30rem]"
      >
        {openActivity &&
          (() => {
            const stats = summarise(openActivity)
            const startedAt = startedAtByActivity.get(openActivity.id)
            const blockStart = blockStartedAt[openActivity.id] ?? startedAt
            return (
              <ActivitySheet
                activity={openActivity}
                amounts={stats.gridAmounts}
                today={today}
                thisPeriod={stats.thisPeriod}
                streak={stats.streak}
                longest={stats.longest}
                total={stats.total}
                trackedTime={stats.trackedTime}
                startedAt={startedAt}
                todayTotal={dayTotals.perActivity.get(openActivity.id) ?? 0}
                inBlock={blockStart !== undefined}
                entries={recentEntries(entries, openActivity.id)}
                // Every activity can hold time now, so an entry can be moved onto any of them.
                timedActivities={visible}
                now={now}
                onDayActivate={(dayKey) => toggleDay(openActivity, stats, dayKey)}
                onStart={() => void startOrResume(openActivity.id)}
                onPause={() => void pause(openActivity.id)}
                onStop={() => void stop(openActivity.id)}
                onResume={
                  // Nothing to take back once it is running again, and an archived activity is not
                  // offered: archiving stopped its timer on purpose.
                  resumable[openActivity.id] !== undefined &&
                  startedAt === undefined &&
                  !openActivity.archived
                    ? () => void resume(openActivity.id)
                    : undefined
                }
                onEdit={() =>
                  setDraft({ draft: draftFrom(openActivity), id: openActivity.id })
                }
                onArchive={() => {
                  void saveActivity({
                    ...openActivity,
                    archived: !openActivity.archived,
                  })
                  setOpenId(null)
                }}
                onMoveEarlier={openIndex > 0 ? () => void move(openIndex, -1) : undefined}
                onMoveLater={
                  openIndex >= 0 && openIndex < visible.length - 1
                    ? () => void move(openIndex, 1)
                    : undefined
                }
                onDelete={() => void remove(openActivity)}
                onClose={() => setOpenId(null)}
              />
            )
          })()}
      </Modal>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        label={draft?.id ? 'Edit activity' : 'New activity'}
        // The dialog is the scroll container, so a tall form on a short screen produces one
        // scrollbar rather than nesting a second one inside it.
        className="m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {draft && (
          <ActivityForm
            initial={draft.draft}
            submitLabel={draft.id ? 'Save' : 'Add activity'}
            onSubmit={async (next) => {
              await saveActivity(toInput(next, draft.id))
              setDraft(null)
            }}
            onCancel={() => setDraft(null)}
          />
        )}
      </Modal>
    </section>
  )
}

/**
 * One activity's most recent stretches, newest first.
 *
 * Sliced from the read the screen already did rather than queried: the dashboard holds a year of
 * entries for the strips and streaks, and the newest thirty of one activity's are in there. The
 * same horizon therefore bounds the sheet's list, its streak and its total, which is the honest
 * arrangement — one number in the sheet cannot see further back than another.
 */
function recentEntries(entries: Entry[], activityId: string): Entry[] {
  const own = entries.filter((entry) => entry.activityId === activityId)
  // `getEntriesInRange` sorts oldest first, so the newest are at the end.
  return own.slice(-SHEET_ENTRIES).reverse()
}

type ActivityStats = {
  amounts: Map<DateKey, number>
  /**
   * The sheet's contribution grid amounts — always the check-offs, since the sheet always draws
   * the grid. The same as `amounts` when the check-off is scored; the completions directly when
   * time is, because `amounts` is then milliseconds.
   */
  gridAmounts: Map<DateKey, number>
  /**
   * day → milliseconds tracked, which is *why* some of those squares are filled. Tapping one of
   * those days cannot clear it, so the screen needs the amount to say what is holding it.
   */
  trackedDays: Map<DateKey, number>
  /** Progress inside the current period of the activity's own target. */
  thisPeriod: number
  /** Progress inside the current week, for the card's weekly progress line. */
  thisWeek: number
  streak: number
  longest: number
  total: number
  /** Time tracked over the horizon — the secondary total a hybrid check-off shows beside its grid. */
  trackedTime: number
}

/**
 * Everything a card and the sheet need about one activity, from the one read the screen did.
 *
 * The measure is not branched on here — `dayAmounts` already erased it — except to choose what
 * "total" means: a count of days for a check-off, a sum of time for a timer.
 */
function summariseActivity(
  activity: Activity,
  entries: Entry[],
  completions: Completion[],
  horizon: { start: number; end: number }[],
  now: number,
): ActivityStats {
  const days = horizon.flatMap((week) => dayWindowsIn(week))
  const amounts = dayAmounts(activity, entries, completions, days, now)

  // The check-off grid's squares. The sheet always draws this grid, so it is always the
  // check-offs: `amounts` already is them when the check-off is the scored axis; when time is,
  // `amounts` is milliseconds, so the squares come from the check-offs directly.
  const gridAmounts =
    activity.measure === 'count'
      ? amounts
      : completionAmounts(activity.id, entries, completions, days, now)
  const trackedDays = trackedByDay(activity.id, entries, days, now)
  const trackedTime = totalSince(entries, activity.id, horizon[0].start, now)

  // With no target of its own an activity is streaked by the day against any amount at all,
  // which is what a filled square already means.
  const period = activity.targetPeriod ?? 'day'
  const target = targetAt(activity, period) ?? 1
  const scored = periodAmounts(amounts, trailingWindows(now, period, STREAK_PERIODS[period]))
  const { current, longest } = streaks(scored, target, now)

  const thisPeriod = periodAmounts(amounts, [periodWindow(now, period)])[0].total
  const thisWeek = periodAmounts(amounts, [periodWindow(now, 'week')])[0].total

  const total =
    activity.measure === 'count'
      ? // Days done, which is exactly the keys of the map the grid is drawn from — the ticked
        // ones and the ones the timer credited. Counting the `done` rows instead would put the
        // total and the streak beside each other disagreeing, since only one of them saw the
        // tracked days. All-time for a tick (check-offs are read whole) and horizon-bounded for
        // a tracked day, which is the bound on the time side everywhere.
        amounts.size
      : [...amounts.values()].reduce((sum, amount) => sum + amount, 0)

  return {
    amounts,
    gridAmounts,
    trackedDays,
    thisPeriod,
    thisWeek,
    streak: current,
    longest,
    total,
    trackedTime,
  }
}

/**
 * Whether a day currently reads as checked off, which is what a tap on it inverts.
 *
 * Not a lookup in the completions table: `gridAmounts` is what the square on screen was drawn
 * from, and it credits a day the timer ran on as well as one that was ticked. Flipping the
 * stored row instead would make the first tap on a timer-credited day appear to do nothing.
 */
const checked = (stats: ActivityStats, day: DateKey) => (stats.gridAmounts.get(day) ?? 0) > 0

/**
 * Every visible card in one grid, habits and timers mixed, reorderable by drag while `editing`.
 *
 * The grid's default `stretch` is what lets the two kinds share it. There were two zones while
 * the grid aligned cards to the top, because a short timer card beside a tall habit card left
 * dead space under it; stretched, every card in a row is the row's height and the timer card's
 * readout centres in what it is given. So the order the owner chose is the only order.
 * `rectSortingStrategy` is the grid-aware one, so the cards reflow across rows as one moves.
 */
function ActivityGrid({
  activities,
  editing,
  compact,
  onReorder,
  renderCard,
}: {
  activities: Activity[]
  editing: boolean
  compact: boolean
  onReorder: (orderedIds: string[]) => void
  renderCard: (activity: Activity) => ReactNode
}) {
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a press meant as a tap does not jump.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = activities.map((activity) => activity.id)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(active.id as string)
    const to = ids.indexOf(over.id as string)
    if (from !== -1 && to !== -1) onReorder(arrayMove(ids, from, to))
  }

  // The smallest a card's column may shrink to before the grid wraps to fewer of them. A shorter
  // card wants a narrower column, so compact packs more across as well as down. `min(…,100%)`
  // keeps a single card from overflowing a hand's-width screen.
  const minColumn = compact ? '15rem' : '20rem'

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div
          className={`mt-3 grid ${compact ? 'gap-2' : 'gap-4'}`}
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(min(${minColumn}, 100%), 1fr))`,
          }}
        >
          {activities.map((activity) => (
            <SortableCard key={activity.id} id={activity.id} editing={editing}>
              {renderCard(activity)}
            </SortableCard>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

/**
 * A card in its sortable slot. Outside reorder mode it is an ordinary card. Inside it, the whole
 * card becomes the drag handle and its own controls go `inert`, so a press starts a drag rather
 * than toggling a day or a timer — which is the reason reordering is a mode and not always on.
 * Works with mouse, touch and keyboard.
 */
function SortableCard({
  id,
  editing,
  children,
}: {
  id: string
  editing: boolean
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editing,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  }

  if (!editing) {
    return (
      <div ref={setNodeRef} style={style} className="h-full">
        {children}
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} className="h-full">
      <div
        {...attributes}
        {...listeners}
        // `touch-none` so a touch-drag reorders the card instead of scrolling the page under it.
        className={`focus-ring h-full touch-none rounded-2xl ${
          isDragging ? 'cursor-grabbing opacity-80 shadow-lg shadow-black/40' : 'cursor-grab'
        }`}
      >
        {/* `inert` lifts the card's own buttons out of pointer, focus and the a11y tree while it
            is a handle; the class also drops them from the pointer path so the press lands here. */}
        <div className="pointer-events-none h-full" inert>
          {children}
        </div>
      </div>
    </div>
  )
}
