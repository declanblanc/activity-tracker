import { isOpen, type Entry } from '../../data/types.ts'
import type { TimeWindow } from '../time.ts'

/**
 * Overlap accounting: how much of a window each activity used, and how much of the
 * window was accounted for at all.
 *
 * Two numbers, and they are not meant to reconcile:
 *
 * - **Per-activity total** — the sum of one activity's own intervals. Timers run
 *   independently and overlap freely, so summing these across activities can exceed
 *   wall-clock. That is correct: three hours with both "Working" and "Deep Work" on
 *   count in full toward each.
 * - **Tracked wall-clock** — the union of every interval from every activity, shared
 *   time counted once. This answers "how much of the window did I account for", and
 *   `untracked` is the rest of it.
 *
 * Pure over `(entries, window, now)`: no Dexie, no React, no date-fns. Windows arrive
 * pre-computed from `lib/time.ts`, so nothing here needs a calendar.
 */

/** One entry's contribution to a window, after clipping. */
type ClippedInterval = {
  activityId: string
  start: number
  end: number
}

export type PeriodTotals = {
  /**
   * The window as asked for, *not* clamped — so a caller can still tell a finished
   * period from one that is in progress (`window.end > now`).
   */
  window: TimeWindow
  /** The window's length after the clamp to `now`: what `untracked` was measured against. */
  length: number
  /** activityId → ms, for activities with any time in the window. */
  perActivity: Map<string, number>
  /** The union across all activities, shared time counted once. */
  tracked: number
  /** `length - tracked`. */
  untracked: number
}

/**
 * The window with its end pulled back to `now`.
 *
 * Future hours are not untracked — nothing could have been tracked in them yet. Without
 * this, a fully-tracked morning reports fifteen hours untracked at 09:00. For a finished
 * period `now` is past the end and the clamp does nothing.
 *
 * A window entirely in the future collapses to zero length rather than going negative;
 * callers read that as "no data yet" instead of dividing by it.
 */
function effectiveWindow(window: TimeWindow, now: number): TimeWindow {
  return {
    start: window.start,
    end: Math.max(window.start, Math.min(window.end, now)),
  }
}

/**
 * Every entry trimmed to the window, dropping those that fall outside it.
 *
 * An interval spanning midnight is never split in storage; it is clipped here, once per
 * window it touches.
 *
 * A running entry ends at `now`, written as an explicit `isOpen` branch. The clamped
 * `bounds.end` is never later than `now`, so taking `endedAt` raw would happen to give
 * the same answer — the sentinel would be swallowed by the `min`. It stays explicit
 * anyway: that equality holds only while the bounds are clamped, and the day someone
 * moves the clamp, `MAX_SAFE_INTEGER` becomes a real end time and every open entry
 * silently stretches to the end of the window.
 */
function clip(entries: Entry[], window: TimeWindow, now: number): ClippedInterval[] {
  const bounds = effectiveWindow(window, now)
  const clipped: ClippedInterval[] = []

  for (const entry of entries) {
    const start = Math.max(entry.startedAt, bounds.start)
    const end = Math.min(isOpen(entry) ? now : entry.endedAt, bounds.end)
    if (end > start) clipped.push({ activityId: entry.activityId, start, end })
  }

  return clipped
}

/** activityId → summed ms inside the window. */
export function perActivityTotals(
  entries: Entry[],
  window: TimeWindow,
  now: number,
): Map<string, number> {
  return sumByActivity(clip(entries, window, now))
}

/**
 * One activity's tracked time from `from` up to `now`, ignoring every other activity.
 *
 * This is what a Tracker card counts: a run of stretches that began when the timer was
 * started and continues across any number of pauses, with no calendar period involved.
 * A stretch still running is counted up to `now`.
 *
 * Summed rather than unioned, like every other per-activity total: one activity cannot
 * hold two open entries, and `saveEntry` folds any overlap a hand-edit introduces, so
 * its intervals are disjoint by construction.
 */
export function totalSince(
  entries: Entry[],
  activityId: string,
  from: number,
  now: number,
): number {
  const own = entries.filter((entry) => entry.activityId === activityId)
  return perActivityTotals(own, { start: from, end: now }, now).get(activityId) ?? 0
}

/** The union of every interval in the window, shared time counted once. */
export function trackedWallClock(entries: Entry[], window: TimeWindow, now: number): number {
  return unionLength(clip(entries, window, now))
}

/** The window length minus the tracked union. */
export function untracked(entries: Entry[], window: TimeWindow, now: number): number {
  const bounds = effectiveWindow(window, now)
  return bounds.end - bounds.start - trackedWallClock(entries, window, now)
}

/**
 * Every number a screen wants about one window, clipping the entries once rather than
 * once per number.
 */
export function periodTotals(entries: Entry[], window: TimeWindow, now: number): PeriodTotals {
  const bounds = effectiveWindow(window, now)
  const clipped = clip(entries, window, now)
  const tracked = unionLength(clipped)
  const length = bounds.end - bounds.start

  return {
    window,
    length,
    perActivity: sumByActivity(clipped),
    tracked,
    untracked: length - tracked,
  }
}

/**
 * One row per window, so charts consume ~30 aggregated rows instead of ~1,500 entries.
 *
 * A pure fold over an already-fetched array: the screen reads the whole range from Dexie
 * once and buckets it in memory.
 */
export function bucketTotals(
  entries: Entry[],
  buckets: TimeWindow[],
  now: number,
): PeriodTotals[] {
  return buckets.map((bucket) => periodTotals(entries, bucket, now))
}

function sumByActivity(clipped: ClippedInterval[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const interval of clipped) {
    const previous = totals.get(interval.activityId) ?? 0
    totals.set(interval.activityId, previous + interval.end - interval.start)
  }
  return totals
}

/**
 * The total length of the merged intervals: sort by start, then sweep, extending the
 * current run while the next interval starts at or before its end.
 *
 * Intervals that merely **touch** are joined here — coverage from 09:00–12:00 and
 * 12:00–14:00 is one continuous five hours whether or not it is stored as one record.
 * That is the opposite of the same-activity storage merge in `saveEntry`, which requires
 * *strict* overlap. The two rules look alike and answer different questions.
 */
function unionLength(clipped: ClippedInterval[]): number {
  const byStart = [...clipped].sort((a, b) => a.start - b.start)
  let union = 0
  let runStart = 0
  let runEnd = 0

  for (const interval of byStart) {
    if (interval.start > runEnd) {
      // Disjoint: bank the finished run and open a new one.
      union += runEnd - runStart
      runStart = interval.start
      runEnd = interval.end
    } else {
      runEnd = Math.max(runEnd, interval.end)
    }
  }

  return union + runEnd - runStart
}
