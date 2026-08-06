import Dexie, { type Table } from 'dexie'
import { setPref } from './prefs.ts'
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

/**
 * The newest `updatedAt` anywhere in the database, or 0 when it is empty.
 *
 * One number standing in for "is there anything here the server has not been told about", which is
 * what lets sync answer that without exporting the whole database to find out. `updatedAt` is
 * indexed on all three tables, so this is three cursors landing on one row each.
 */
export async function latestLocalChange(): Promise<number> {
  const newest = await Promise.all([
    db.activities.orderBy('updatedAt').last(),
    db.entries.orderBy('updatedAt').last(),
    db.completions.orderBy('updatedAt').last(),
  ])
  return Math.max(0, ...newest.map((record) => record?.updatedAt ?? 0))
}

/**
 * Erase every domain record on this device.
 *
 * ponytail: an intentional hard delete — the one place in `data/` that does not soft-delete.
 * The owner has explicitly asked to wipe everything, so leaving `deletedAt` tombstones behind
 * would defeat the request. Sync is last-write-wins over a whole-database blob, so this only
 * clears the local copy; a later sync re-merges from whatever devices still hold data. Device
 * prefs — the sync token included — are left untouched.
 */
export async function deleteAllData(): Promise<void> {
  // Forget which server blob this device has merged, so the next sync downloads it whole instead
  // of reading its own emptiness as agreement with the server. That is what keeps the promise the
  // Settings copy makes — the data comes back while the token is still there — now that a sync
  // with nothing to say is a conditional request that transfers nothing.
  setPref('mergedServerVersion', 0)

  await db.transaction('rw', db.activities, db.entries, db.completions, async () => {
    await db.activities.clear()
    await db.entries.clear()
    await db.completions.clear()
  })
}
