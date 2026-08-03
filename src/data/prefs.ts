import type { Period } from './types.ts'

/**
 * Persisted device settings — the second of the three state tiers (Dexie for domain data,
 * this for device settings, component state for the ephemeral rest).
 *
 * These are device-local and never synced: a UI preference is not worth a conflict rule.
 * They live in `localStorage` rather than a fourth Dexie table so they can never force a
 * schema migration. Losing them to storage eviction costs a forgotten preference, which is
 * self-healing.
 *
 * This module is the only place in the app that touches `localStorage`.
 */

/** The complete list of persisted device state. */
type Prefs = {
  insightsScale: Period
  /** Epoch ms; 0 = not snoozed. */
  forgottenPromptSnoozedUntil: number
  /**
   * activityId → when its current *block* began: the moment the timer was started, kept
   * across every pause until it is stopped. Absent means no block is open, so the next start
   * begins one. Only duration activities appear here — a check-off has no block.
   *
   * This is the whole difference between pausing and stopping. Both write the same thing — a
   * closed entry — and the record has no notion of either; the block is a device-local
   * reading of those entries, which is why it lives here.
   *
   * A block is not a calendar period. It ends when it is stopped, however many days later,
   * so a sleep timer or a multi-day fast reads as one thing.
   */
  blockStartedAt: Record<string, number>
  /**
   * activityId → where the most recently *stopped* block began, kept so that stop can be
   * taken back. Absent once the activity is started again, because a new block supersedes
   * the one before it.
   *
   * Stopping is the only thing the dashboard does that the record cannot express, so it is the
   * only thing needing an undo: pausing keeps the block, and every other mistake is an entry the
   * activity's own sheet can already edit.
   */
  resumableBlockStartedAt: Record<string, number>
}

const DEFAULTS: Prefs = {
  insightsScale: 'day',
  forgottenPromptSnoozedUntil: 0,
  blockStartedAt: {},
  resumableBlockStartedAt: {},
}

const storageKey = (key: keyof Prefs) => `activity-tracker.${key}`

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  const stored = localStorage.getItem(storageKey(key))
  if (stored === null) return DEFAULTS[key]
  try {
    return JSON.parse(stored) as Prefs[K]
  } catch {
    // A hand-edited or half-written value is not worth crashing a screen over.
    return DEFAULTS[key]
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  localStorage.setItem(storageKey(key), JSON.stringify(value))
}

/** The prefs that map activity ids to a timestamp. */
type ActivityStampPref = 'blockStartedAt' | 'resumableBlockStartedAt'

/**
 * Set or clear one activity's timestamp in a per-activity pref, returning the whole new map
 * so a caller can mirror it in component state.
 *
 * Both block markers have this shape and both are read-modify-write from more than one
 * screen. Doing it here keeps "a missing key means no block" a fact one module knows.
 */
export function setActivityStamp(
  key: ActivityStampPref,
  activityId: string,
  at?: number,
): Record<string, number> {
  const next = { ...getPref(key) }
  if (at === undefined) delete next[activityId]
  else next[activityId] = at
  setPref(key, next)
  return next
}
