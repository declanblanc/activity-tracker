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
  /** Activities screen: drop each card's heat strip so more fit on one page. */
  compactActivities: boolean
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
  /**
   * The shared secret the sync API checks, pasted in once per device. Empty means sync is off.
   *
   * Device-local like everything else here, and that is the point rather than an accident: it is
   * the one value that must never travel inside the synced blob.
   */
  syncToken: string
  /** Epoch ms of the last successful sync, on this device's clock; 0 = never. Display only. */
  lastSyncAt: number
  /**
   * The version — the server's `updatedAt` — of the blob this device has merged; 0 = none yet.
   *
   * Sync sends it back as the condition on both halves of the exchange: `If-None-Match` on the
   * download, so a poll that finds nothing new costs one small response instead of the whole
   * database, and `If-Match` on the upload, so a write that another device beat to it is refused
   * rather than silently overwriting that device's records.
   *
   * Device-local like everything else here, and it has to be: it describes what *this* device has
   * seen. Losing it costs one full download.
   */
  mergedServerVersion: number
  /**
   * The newest local `updatedAt` the server is known to hold; 0 = nothing uploaded yet.
   *
   * The whole upload decision: a local edit pushes the newest `updatedAt` past this, and nothing
   * else does. Losing it costs one full upload.
   */
  uploadedLocalChange: number
}

const DEFAULTS: Prefs = {
  insightsScale: 'day',
  compactActivities: false,
  forgottenPromptSnoozedUntil: 0,
  blockStartedAt: {},
  resumableBlockStartedAt: {},
  syncToken: '',
  lastSyncAt: 0,
  mergedServerVersion: 0,
  uploadedLocalChange: 0,
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
