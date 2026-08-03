import { useLiveQuery } from 'dexie-react-hooks'
import { LayoutGrid, Plus } from 'lucide-react'
import { useState } from 'react'
import ActivityForm from '../components/ActivityForm.tsx'
import { blankDraft, draftFrom, toInput, type Draft } from '../components/activityDraft.ts'
import { CountCard, DurationCard } from '../components/ActivityCard.tsx'
import ActivitySheet from '../components/ActivitySheet.tsx'
import EntryForm from '../components/EntryForm.tsx'
import { blankDraft as blankEntryDraft, type Draft as EntryDraft } from '../components/entryDraft.ts'
import Button from '../components/ui/Button.tsx'
import EmptyState from '../components/ui/EmptyState.tsx'
import Meter from '../components/ui/Meter.tsx'
import { Modal } from '../components/ui/Modal.tsx'
import Toast from '../components/ui/Toast.tsx'
import {
  getActivities,
  reorderActivities,
  saveActivity,
  softDeleteActivity,
} from '../data/activities.ts'
import { getCompletions, toggleCompletion } from '../data/completions.ts'
import {
  getEntriesInRange,
  getOpenEntries,
  MIN_TRACKED_MS,
  startActivity,
  stopActivity,
} from '../data/entries.ts'
import { getPref, setActivityStamp } from '../data/prefs.ts'
import {
  OPEN_ENTRY_END,
  type Activity,
  type Completion,
  type DateKey,
  type Entry,
  type Period,
} from '../data/types.ts'
import { streaks, targetAt } from '../lib/accounting/goals.ts'
import { periodTotals, totalSince, type PeriodTotals } from '../lib/accounting/totals.ts'
import { dayAmounts, periodAmounts } from '../lib/days.ts'
import { formatDuration } from '../lib/format.ts'
import { nextColor } from '../lib/palette.ts'
import { dayWindow, dayWindowsIn, parseKey, periodWindow, trailingWindows } from '../lib/time.ts'
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
 * stop with a live reading. Both carry the same heat strip, because `lib/days.ts` reduces both
 * to one amount per day — which is the whole reason this is one screen and not two.
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
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
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
  // Archived ones count: an activity archived at noon still tracked the morning, and the day's
  // coverage has to account for it.
  const anyTimed = activities.some((activity) => activity.measure === 'duration')

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
      // A new block discards the stopped one the Log could have offered back: once time is
      // being tracked against a fresh block, the old one is history.
      setActivityStamp('resumableBlockStartedAt', activityId, undefined)
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
   * End the block as well as the entry, filing where it began so the Log can put it back.
   * Stopping is otherwise the one action here that loses something no entry records.
   */
  const stop = async (activityId: string) => {
    const blockStart = blockStartedAt[activityId] ?? startedAtByActivity.get(activityId)
    const { discarded } = await stopActivity(activityId)
    setBlockStart(activityId, undefined)
    if (blockStart !== undefined) {
      setActivityStamp('resumableBlockStartedAt', activityId, blockStart)
    }
    if (discarded) reportDiscarded(activityId)
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

  /** A timed day cannot be "ticked", so its square opens the entry form pointed at that day. */
  const openDay = (activity: Activity, dayKey: DateKey) => {
    if (activity.measure === 'count') {
      void toggleCompletion(activity.id, dayKey)
      return
    }
    // Nine in the morning on the day that was tapped: a start time that has to be corrected is
    // better than one that defaults to now and files the time under the wrong day.
    const at = parseKey(dayKey).getTime() + 9 * 60 * 60 * 1000
    setEntryDraft({ ...blankEntryDraft(at), activityId: activity.id })
  }

  const openActivity = activities.find((activity) => activity.id === openId)
  const openIndex = visible.findIndex((activity) => activity.id === openId)

  return (
    <section className="screen-pad mx-auto w-full max-w-3xl">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink">Activities</h1>
        {/* Adding an activity happens once a month; logging one happens all day. This is
            deliberately not the loudest thing on the screen. */}
        <Button onClick={() => setDraft({ draft: blankDraft(nextColor(activities.length)) })}>
          <Plus className="size-4" aria-hidden />
          Add activity
        </Button>
      </header>

      {/* Coverage of the day, and so only meaningful when something is timed: a check-off
          contributes no time, and cannot be in either the numerator or the denominator.
          ponytail: no count half to this panel — "4 of 6 done today" is legible from the grid
          below, where a completed card wears a filled tick. */}
      {anyTimed && <DaySummary day={dayTotals} running={openEntries.length} />}

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

      {/* `items-start`: a timed card carries no heat strip and so is much shorter than a check-off
          card. Without it the grid row would stretch it to match its tallest neighbour. */}
      <div className="mt-3 grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(20rem,100%),1fr))]">
        {visible.map((activity) => {
          const stats = summarise(activity)
          const startedAt = startedAtByActivity.get(activity.id)
          // A running card with no recorded block treats its own stretch as one, so a timer
          // left open across cleared storage still reads sensibly.
          const blockStart = blockStartedAt[activity.id] ?? startedAt
          const shared = {
            activity,
            onOpen: () => setOpenId(activity.id),
            onDelete: () => void remove(activity),
          }

          return activity.measure === 'count' ? (
            <CountCard
              key={activity.id}
              {...shared}
              amounts={stats.amounts}
              today={today}
              onToggleDay={(dayKey) => void toggleCompletion(activity.id, dayKey)}
              thisWeek={stats.thisWeek}
              streak={stats.streak}
              total={stats.total}
              onToggleToday={() => void toggleCompletion(activity.id, today)}
            />
          ) : (
            <DurationCard
              key={activity.id}
              {...shared}
              startedAt={startedAt}
              blockBefore={blockBefore(entries, activity.id, blockStart, startedAt, now)}
              inBlock={blockStart !== undefined}
              todayTotal={dayTotals.perActivity.get(activity.id) ?? 0}
              thisWeek={stats.thisWeek}
              streak={stats.streak}
              total={stats.total}
              onStart={() => void startOrResume(activity.id)}
              onPause={() => void pause(activity.id)}
              onStop={() => void stop(activity.id)}
            />
          )
        })}
      </div>

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
                amounts={stats.amounts}
                today={today}
                thisPeriod={stats.thisPeriod}
                streak={stats.streak}
                longest={stats.longest}
                total={stats.total}
                startedAt={startedAt}
                blockBefore={blockBefore(entries, openActivity.id, blockStart, startedAt, now)}
                inBlock={blockStart !== undefined}
                onDayActivate={(dayKey) => openDay(openActivity, dayKey)}
                onStart={() => void startOrResume(openActivity.id)}
                onPause={() => void pause(openActivity.id)}
                onStop={() => void stop(openActivity.id)}
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
            editing={draft.id !== undefined}
            submitLabel={draft.id ? 'Save' : 'Add activity'}
            onSubmit={async (next) => {
              await saveActivity(toInput(next, draft.id))
              setDraft(null)
            }}
            onCancel={() => setDraft(null)}
          />
        )}
      </Modal>

      <Modal
        open={entryDraft !== null}
        onClose={() => setEntryDraft(null)}
        label="Add time"
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto"
      >
        {entryDraft && (
          <div className="rounded-2xl bg-surface p-5 shadow-xl">
            <EntryForm
              draft={entryDraft}
              // Only timed activities can hold an interval, so only they are offered.
              activities={activities.filter((activity) => activity.measure === 'duration')}
              onChange={setEntryDraft}
              onClose={() => setEntryDraft(null)}
            />
          </div>
        )}
      </Modal>
    </section>
  )
}

/**
 * Tracked time in the current block, *excluding* the stretch running right now.
 *
 * The card adds the running stretch itself so it can tick once a second without the screen
 * re-rendering, so what it wants here is the block up to the moment that stretch began.
 */
function blockBefore(
  entries: Entry[],
  activityId: string,
  blockStart: number | undefined,
  startedAt: number | undefined,
  now: number,
): number {
  if (blockStart === undefined) return 0
  return totalSince(entries, activityId, blockStart, startedAt ?? now)
}

type ActivityStats = {
  amounts: Map<DateKey, number>
  /** Progress inside the current period of the activity's own target. */
  thisPeriod: number
  /** Progress inside the current week, for the card's weekly progress line. */
  thisWeek: number
  streak: number
  longest: number
  total: number
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
      ? // All-time, because completions are read whole rather than bounded by the horizon.
        completions.filter((row) => row.activityId === activity.id && row.done).length
      : [...amounts.values()].reduce((sum, amount) => sum + amount, 0)

  return { amounts, thisPeriod, thisWeek, streak: current, longest, total }
}

/**
 * The day so far: how much of it is accounted for at all.
 *
 * Tracked is the *union* of every interval, so four timers running at once still cannot push it
 * past the hours elapsed — which is what makes untracked mean anything. The denominator is the
 * day clamped to now, so a fully-tracked morning reads zero untracked at 09:00 rather than owing
 * the rest of the day.
 *
 * This is deliberately a different question from the number on a card. A card counts its block;
 * this counts the day. They are not meant to agree, so they say which they are.
 */
function DaySummary({ day, running }: { day: PeriodTotals; running: number }) {
  return (
    <div className="panel mt-3 p-4">
      <p className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Tracked today
      </p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">
        {formatDuration(day.tracked)}
      </p>
      <Meter fraction={day.length > 0 ? day.tracked / day.length : 0} />
      <p className="mt-2 text-xs text-ink-muted">
        {formatDuration(day.untracked)} untracked of {formatDuration(day.length)} so far
        {running > 0 && ` · ${running} running`}
      </p>
    </div>
  )
}
