import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, expect, it, vi } from 'vitest'
import { ActivityTrackerDB, db, deleteAllData, latestLocalChange } from './db.ts'
import { getPref, setPref } from './prefs.ts'
import { NOT_DELETED, OPEN_ENTRY_END } from './types.ts'

beforeEach(async () => {
  // `deleteAllData` writes a pref, and the node environment has no `localStorage`.
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })
  await Promise.all([db.activities.clear(), db.entries.clear(), db.completions.clear()])
})

const activity = (updatedAt: number) => ({
  id: 'a',
  name: 'Read',
  color: '#000',
  measure: 'count' as const,
  archived: false,
  sortOrder: 0,
  createdAt: 1,
  updatedAt,
  deletedAt: NOT_DELETED,
})

const entry = (updatedAt: number) => ({
  id: 'e',
  activityId: 'a',
  startedAt: 1,
  endedAt: OPEN_ENTRY_END,
  createdAt: 1,
  updatedAt,
  deletedAt: NOT_DELETED,
})

const completion = (updatedAt: number) => ({
  id: 'a:2026-08-03',
  activityId: 'a',
  day: '2026-08-03',
  done: true,
  updatedAt,
})

it('empties all three tables, tombstones included', async () => {
  await db.activities.put(activity(1))
  await db.entries.put(entry(1))
  await db.completions.put(completion(1))

  await deleteAllData()

  expect(await db.activities.count()).toBe(0)
  expect(await db.entries.count()).toBe(0)
  expect(await db.completions.count()).toBe(0)
})

// Without this the next sync would read the wiped database as agreement with the server and
// download nothing, so the data would not come back the way Settings says it does.
it('forgets the merged server version, so the next sync downloads the blob whole', async () => {
  setPref('mergedServerVersion', 1234)

  await deleteAllData()

  expect(getPref('mergedServerVersion')).toBe(0)
})

it('reports the newest updatedAt across all three tables', async () => {
  expect(await latestLocalChange()).toBe(0)

  await db.activities.put(activity(10))
  await db.entries.put(entry(30))
  await db.completions.put(completion(20))

  expect(await latestLocalChange()).toBe(30)
})

// The version 1 schema, so the upgrade below runs against a database shaped the way a device that
// has not opened this build still holds — a pair of card flags where there is now one `display`.
const V1_STORES = {
  activities: 'id, sortOrder, updatedAt, deletedAt',
  entries: 'id, activityId, startedAt, endedAt, [activityId+endedAt], updatedAt, deletedAt',
  completions: 'id, day, updatedAt',
}

it('folds the legacy card flags into one display mode', async () => {
  const name = 'legacy-flags'
  const legacy = new Dexie(name)
  legacy.version(1).stores(V1_STORES)
  await legacy.table('activities').bulkPut([
    // Only one axis on: that axis is the mode, whatever the goal is scored on.
    { ...activity(1), id: 'timer-only', showCheckoff: false, showTimer: true },
    { ...activity(1), id: 'checkoff-only', measure: 'duration', showCheckoff: true, showTimer: false },
    // Both on — the old default — never chose, so the measure picks the card, exactly as the list
    // used to. Same for a record older than the flags.
    { ...activity(1), id: 'both', showCheckoff: true, showTimer: true },
    { ...activity(1), id: 'both-timed', measure: 'duration', showCheckoff: true, showTimer: true },
    { ...activity(1), id: 'neither', measure: 'duration' },
  ])
  legacy.close()

  const upgraded = new ActivityTrackerDB(name)
  const rows = await upgraded.activities.orderBy('id').toArray()
  upgraded.close()

  expect(rows.map((row) => [row.id, row.display])).toEqual([
    ['both', 'habit'],
    ['both-timed', 'timer'],
    ['checkoff-only', 'habit'],
    ['neither', 'timer'],
    ['timer-only', 'timer'],
  ])
  // The flags are gone, and each row is restamped so the migrated answer wins last-write-wins
  // against a device still holding the pair.
  for (const row of rows) {
    expect(row).not.toHaveProperty('showCheckoff')
    expect(row).not.toHaveProperty('showTimer')
    expect(row.updatedAt).toBeGreaterThan(1)
  }
})
