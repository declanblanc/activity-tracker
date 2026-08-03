/**
 * Domain records and the sentinel encoding they are stored with.
 *
 * `endedAt` and `deletedAt` are the two fields whose natural domain includes "absent",
 * and both are indexed — so neither may ever hold `null`. `null` is not a valid IndexedDB
 * key: a record with a null indexed value silently vanishes from that index, and
 * `where(field).equals(null)` throws. Open-ness and liveness use numeric sentinels
 * instead. Only `src/data/` knows they exist; the export format translates them back to
 * `null` at the file boundary.
 */

/** `endedAt` of an entry that is still running. */
export const OPEN_ENTRY_END = Number.MAX_SAFE_INTEGER

/** `deletedAt` of a record that has not been soft-deleted. */
export const NOT_DELETED = 0

/** Client-generated primary key, so records exist before any sync does. */
export function newId(): string {
  return crypto.randomUUID()
}

/** `YYYY-MM-DD`, always derived from *local* calendar parts. See `lib/time.ts`. */
export type DateKey = string

/**
 * The three period sizes everything is read at, and the size a target is set at.
 *
 * One type, not two: the sibling app kept a `Scale` for reading and a `TargetPeriod` for
 * goals as separate but structurally identical types, and every use compared them with
 * `===` anyway.
 */
export type Period = 'day' | 'week' | 'month'

/**
 * How an activity is recorded — the only field that changes what the rest of the app does
 * with one.
 *
 * - `duration` runs a timer and stores `Entry` intervals.
 * - `count` is checked off once per local day and stores `Completion` rows.
 *
 * Everything else — icon, colour, target, archive, order, soft delete, the heat grid, the
 * streak, the goals panel — is shared between them. That sharing is the whole point of
 * having one entity instead of two.
 */
export type Measure = 'count' | 'duration'

export type Activity = {
  id: string
  name: string
  /** Optional prose. The detail sheet shows it; nothing computes on it. */
  description?: string
  /** Hex, from the palette in `lib/palette.ts`. */
  color: string
  /** Emoji. */
  icon?: string
  measure: Measure
  /**
   * The goal, in the unit the measure counts in: **days** for `count`, **milliseconds**
   * for `duration`. Absent means the activity has no goal.
   *
   * `count` + `day` is "every day", and its amount is always 1. `count` + `week` with an
   * amount of 3 is "three days a week" — the days need not be consecutive, and a fourth
   * day in the same week does not count twice.
   */
  targetAmount?: number
  targetPeriod?: Period
  archived: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
  /** `NOT_DELETED`, or the tombstone timestamp. Never `null`. */
  deletedAt: number
}

/**
 * What a caller supplies to `saveActivity`. An absent `id` means insert; the fields the
 * data layer owns (`sortOrder`, the timestamp trio) are never passed in.
 *
 * `measure` is required on insert and ignored on update — it cannot change once records
 * exist under it. See `saveActivity`.
 */
export type ActivityInput = {
  id?: string
  name: string
  description?: string
  color: string
  icon?: string
  measure: Measure
  targetAmount?: number
  targetPeriod?: Period
  archived?: boolean
}

/** One interval of a `duration` activity being on. */
export type Entry = {
  id: string
  activityId: string
  /** UTC epoch ms. */
  startedAt: number
  /** UTC epoch ms, or `OPEN_ENTRY_END` while the entry is open. Never `null`. */
  endedAt: number
  note?: string
  createdAt: number
  updatedAt: number
  /** `NOT_DELETED`, or the tombstone timestamp. Never `null`. */
  deletedAt: number
}

/**
 * What a caller supplies to `saveEntry`. An absent `id` means insert; the timestamp trio
 * is owned by the data layer.
 *
 * `endedAt` is `null` for an entry that is to stay running: the sentinel encoding stops at
 * the edge of `src/data/`, so a screen says "open" with the domain value. Either form is
 * only valid for an entry that is *already* open — entries are closed, never reopened.
 */
export type EntryInput = {
  id?: string
  activityId: string
  startedAt: number
  endedAt: number | null
  note?: string
}

/**
 * One day's decision about one `count` activity.
 *
 * The presence of a row means "a decision was recorded"; `done` is what it was. **`done:
 * false` is a real value and this table's tombstone** — an un-log — not an absence.
 * Without it, a stale row arriving from an import could resurrect a day the owner
 * deliberately cleared.
 *
 * `done` is a boolean and so may never be indexed: booleans are not valid IndexedDB keys,
 * exactly the trap `null` is. It is filtered in memory.
 *
 * There is no `deletedAt` here, unlike every other record in this directory: `done: false`
 * already *is* the tombstone, and a second one would need a rule about which of the two
 * wins. There is no `createdAt` either — nothing displays it, and `updatedAt` is all the
 * last-write-wins merge needs.
 */
export type Completion = {
  /** `${activityId}:${day}` — derived, so one activity-day can never hold two rows. */
  id: string
  activityId: string
  day: DateKey
  done: boolean
  updatedAt: number
}

/**
 * The primary key of a completion, derived rather than random.
 *
 * Activity ids are UUIDs and contain no `:`, which makes the join unambiguous. Deriving it
 * is what makes one-row-per-activity-day structural instead of something a transaction has
 * to check, and it means an import can recompute the key rather than trust the file's.
 */
export const completionId = (activityId: string, day: DateKey) => `${activityId}:${day}`

export const isOpen = (entry: Entry) => entry.endedAt === OPEN_ENTRY_END

export const isLive = (record: { deletedAt: number }) => record.deletedAt === NOT_DELETED
