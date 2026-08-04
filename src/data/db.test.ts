import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { db, deleteAllData } from './db.ts'
import { NOT_DELETED, OPEN_ENTRY_END } from './types.ts'

beforeEach(async () => {
  await Promise.all([db.activities.clear(), db.entries.clear(), db.completions.clear()])
})

it('empties all three tables, tombstones included', async () => {
  await db.activities.put({
    id: 'a',
    name: 'Read',
    color: '#000',
    measure: 'count',
    archived: false,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: NOT_DELETED,
  })
  await db.entries.put({
    id: 'e',
    activityId: 'a',
    startedAt: 1,
    endedAt: OPEN_ENTRY_END,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: NOT_DELETED,
  })
  await db.completions.put({ id: 'a:2026-08-03', activityId: 'a', day: '2026-08-03', done: true, updatedAt: 1 })

  await deleteAllData()

  expect(await db.activities.count()).toBe(0)
  expect(await db.entries.count()).toBe(0)
  expect(await db.completions.count()).toBe(0)
})
