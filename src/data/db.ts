import Dexie, { type Table } from 'dexie'
import type { Activity, Completion, Entry } from './types.ts'

/**
 * The only Dexie instance. Nothing outside `src/data/` imports it — that is what keeps
 * cloud sync a change to this directory alone.
 *
 * Every syncable field is present from version 1, including `updatedAt` and the
 * `deletedAt` tombstone, so turning on sync needs no migration.
 */
export class ActivityTrackerDB extends Dexie {
  activities!: Table<Activity, string>
  entries!: Table<Entry, string>
  completions!: Table<Completion, string>

  constructor(name = 'activity-tracker') {
    super(name)
    // `archived` and `measure` are deliberately NOT indexed. Booleans are not valid
    // IndexedDB keys, so `archived: false` would silently drop the record from that index
    // — the same trap as `null`; and with ~10 activities both are in-memory predicates.
    this.version(1).stores({
      activities: 'id, sortOrder, updatedAt, deletedAt',
      entries: 'id, activityId, startedAt, endedAt, [activityId+endedAt], updatedAt, deletedAt',
      // `done` is not indexed for the boolean reason above, and `false` is a value this
      // table must keep rather than a state it can omit. There is no `activityId` index
      // either: the primary key *starts* with the activity id, so
      // `where('id').startsWith(`${activityId}:`)` is already a prefix scan on it.
      completions: 'id, day, updatedAt',
    })
  }
}

export const db = new ActivityTrackerDB()
