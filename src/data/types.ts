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
 * The three period sizes a target is set at, and the three the history repeats over.
 *
 * One type, not two: the sibling app kept a `Scale` for reading and a `TargetPeriod` for
 * goals as separate but structurally identical types, and every use compared them with
 * `===` anyway. See `Scale` for where the two axes finally do diverge.
 */
export type Period = 'day' | 'week' | 'month'

/**
 * The lens Insights reads through — the three periods plus `all-time`.
 *
 * `Scale` is a *superset* of `Period`, and the difference is the whole reason the two are split
 * again after the merge above. `all-time` is a way to *read* history (one unbounded window, no
 * previous or next), never a size a goal can be *set* at — "40h all-time" is not a commitment
 * with a rate. Keeping it out of `Period` keeps it out of the goal form, the target validators
 * and the streak arithmetic, all of which stay exhaustively keyed by the three real periods.
 */
export type Scale = Period | 'all-time'

/**
 * Which axis an activity is *scored* on — the one the single goal, the streak, the "total" and
 * the sheet's lead layout are about. Not what it stores (every activity can store both
 * `Completion` rows and `Entry` intervals) and not what its card shows (`display` decides
 * that, independently of this).
 *
 * - `count` scores the check-off, and its goal counts **days**.
 * - `duration` scores the timer, and its goal counts **milliseconds**.
 *
 * `dayAmounts` branches on this one field and nowhere else, so everything downstream — streaks,
 * the goals panel — sees one amount per day and stays axis-agnostic. `measure` *can* change: it
 * shapes no stored record, so flipping it is safe (it clears a goal whose unit no longer applies).
 */
export type Measure = 'count' | 'duration'

/**
 * Which card an activity gets on the Activities list, and nothing else.
 *
 * One choice, not two flags: the list draws one card per activity, so "both" was never a state it
 * could honour. `habit` draws the check-off heat map, `timer` the start/stop reading. Independent
 * of `measure` — a timer card can be scored on the check-off, and its own sheet shows both axes
 * whichever mode this is.
 */
export type DisplayMode = 'habit' | 'timer'

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
  /**
   * Which card this activity gets on the Activities list. Display only — every activity can
   * record both check-offs and intervals (the storage layer never guarded it), and its own sheet
   * always shows both regardless of this. Decoupled from `measure`: the goal may be scored on the
   * axis the card does not draw.
   *
   * Optional only so a blob exported before the field existed imports unchanged; `displayMode`
   * falls back to `measure` for such a record. Every stored record has one — the v2 upgrade in
   * `db.ts` gave the legacy `showCheckoff` / `showTimer` pair its single answer.
   */
  display?: DisplayMode
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
 * `measure` is required on insert and may change on update — see `saveActivity`.
 */
export type ActivityInput = {
  id?: string
  name: string
  description?: string
  color: string
  icon?: string
  /** The goal axis. May change on update — see `Measure`. */
  measure: Measure
  targetAmount?: number
  targetPeriod?: Period
  /** Which card the Activities list draws. See `Activity.display`. */
  display?: DisplayMode
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
 * What it cannot do is take back a day the timer ran on: tracked time checks a day off
 * outright, so a `done: false` row on such a day is inert (see `completionAmounts`). The
 * un-log gesture is the whole of this table's job on an *untracked* day, and the dashboard
 * says as much when a tracked square is tapped.
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

/**
 * Which card the Activities list draws for this activity.
 *
 * Not "can hold time" or "can be checked off" — every activity can do both, which is why nothing
 * outside that one list reads this. Falls back to `measure` for a record imported from before the
 * field existed. See `Activity.display`.
 */
export const displayMode = (activity: Pick<Activity, 'measure' | 'display'>): DisplayMode =>
  activity.display ?? (activity.measure === 'duration' ? 'timer' : 'habit')
