// Runs against a real (in-memory) IndexedDB rather than a mock, because the two
// things worth checking here — that the `sortOrder` index actually orders reads, and
// that archiving reaches across into the entries table — are exactly what a fake
// would paper over.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getActivities,
  getDeletedActivities,
  reorderActivities,
  restoreActivity,
  saveActivity,
  softDeleteActivity,
} from './activities.ts'
import { db } from './db.ts'
import { NOT_DELETED, OPEN_ENTRY_END, newId, type Entry } from './types.ts'

const create = (name: string) =>
  saveActivity({ name, color: '#38bdf8', measure: 'duration' })

function openEntry(activityId: string): Entry {
  return {
    id: newId(),
    activityId,
    startedAt: Date.now() - 60_000,
    endedAt: OPEN_ENTRY_END,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: NOT_DELETED,
  }
}

beforeEach(async () => {
  await db.activities.clear()
  await db.entries.clear()
})

describe('saveActivity', () => {
  it('rejects a blank name', async () => {
    await expect(saveActivity({ name: '   ', color: '#38bdf8', measure: 'duration' })).rejects.toThrow(/name/)
  })

  it('rejects a non-positive target', async () => {
    await expect(
      saveActivity({ name: 'Reading', color: '#38bdf8', measure: 'duration', targetAmount: 0, targetPeriod: 'week' }),
    ).rejects.toThrow(/greater than zero/)
  })

  it('rejects a target that is not a number at all', async () => {
    await expect(
      saveActivity({
        name: 'Reading',
        color: '#38bdf8',
        measure: 'duration',
        targetAmount: Number.NaN,
        targetPeriod: 'week',
      }),
    ).rejects.toThrow(/greater than zero/)
  })

  it('rejects a count target of more days than the period holds', async () => {
    // "Nine days a week" can never be met, so it is not a goal.
    await expect(
      saveActivity({
        name: 'Stretching',
        color: '#38bdf8',
        measure: 'count',
        targetAmount: 9,
        targetPeriod: 'week',
      }),
    ).rejects.toThrow(/never be met/)
  })

  it('rejects a fractional count target', async () => {
    await expect(
      saveActivity({
        name: 'Stretching',
        color: '#38bdf8',
        measure: 'count',
        targetAmount: 2.5,
        targetPeriod: 'week',
      }),
    ).rejects.toThrow(/whole number/)
  })

  it('accepts a fractional duration target, which is a measurement not a day count', async () => {
    const saved = await saveActivity({
      name: 'Reading',
      color: '#38bdf8',
      measure: 'duration',
      targetAmount: 90 * 60 * 1000,
      targetPeriod: 'day',
    })
    expect(saved.targetAmount).toBe(90 * 60 * 1000)
  })

  it('accepts a duration target far above any count ceiling', async () => {
    // 40 hours a week is 144e6 ms — nonsense as a day count, ordinary as a duration.
    const saved = await saveActivity({
      name: 'Work',
      color: '#38bdf8',
      measure: 'duration',
      targetAmount: 40 * 60 * 60 * 1000,
      targetPeriod: 'week',
    })
    expect(saved.targetAmount).toBe(40 * 60 * 60 * 1000)
  })

  it('ignores an attempt to change the measure of an existing activity', async () => {
    // Its records are shaped by the measure: a change would either invent times a
    // check-off never had or discard every interval, and would redenominate the target.
    const activity = await saveActivity({
      name: 'Stretching',
      color: '#38bdf8',
      measure: 'count',
    })

    const updated = await saveActivity({ ...activity, measure: 'duration' })

    expect(updated.measure).toBe('count')
  })

  it('validates a target against the stored measure, not the submitted one', async () => {
    const activity = await saveActivity({
      name: 'Stretching',
      color: '#38bdf8',
      measure: 'count',
    })

    // Submitting `duration` must not buy a way past the count ceiling.
    await expect(
      saveActivity({ ...activity, measure: 'duration', targetAmount: 9, targetPeriod: 'week' }),
    ).rejects.toThrow(/never be met/)
  })

  it('appends new activities in creation order', async () => {
    await create('Sleeping')
    await create('Deep Work')

    expect((await getActivities()).map((a) => a.name)).toEqual(['Sleeping', 'Deep Work'])
  })

  it('updates in place and refreshes updatedAt, keeping the id and position', async () => {
    const first = await create('Sleeping')
    await create('Deep Work')

    const renamed = await saveActivity({ id: first.id, name: 'Sleep', color: '#f472b6', measure: 'duration' })

    expect(renamed.id).toBe(first.id)
    expect(renamed.sortOrder).toBe(first.sortOrder)
    expect(renamed.createdAt).toBe(first.createdAt)
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
    expect((await getActivities()).map((a) => a.name)).toEqual(['Sleep', 'Deep Work'])
  })

  it('hides an archived activity but keeps it available on request', async () => {
    const activity = await create('Sleeping')
    await saveActivity({ ...activity, archived: true })

    expect(await getActivities()).toEqual([])
    expect((await getActivities(true)).map((a) => a.name)).toEqual(['Sleeping'])
  })

  it('closes an open entry when the activity is archived', async () => {
    const activity = await create('Sleeping')
    const running = openEntry(activity.id)
    await db.entries.add(running)

    await saveActivity({ ...activity, archived: true })

    const closed = await db.entries.get(running.id)
    expect(closed?.endedAt).toBeLessThan(OPEN_ENTRY_END)
    expect(closed?.endedAt).toBeGreaterThan(running.startedAt)
  })

  it('leaves an unrelated activity still running', async () => {
    const archived = await create('Sleeping')
    const other = await create('Deep Work')
    const stillRunning = openEntry(other.id)
    await db.entries.bulkAdd([openEntry(archived.id), stillRunning])

    await saveActivity({ ...archived, archived: true })

    expect((await db.entries.get(stillRunning.id))?.endedAt).toBe(OPEN_ENTRY_END)
  })
})

describe('softDeleteActivity', () => {
  it('tombstones the activity, closes its open entry, and keeps its history', async () => {
    const activity = await create('Sleeping')
    const running = openEntry(activity.id)
    await db.entries.add(running)

    await softDeleteActivity(activity.id)

    expect(await getActivities(true)).toEqual([])
    expect((await db.activities.get(activity.id))?.deletedAt).toBeGreaterThan(NOT_DELETED)
    expect((await db.entries.get(running.id))?.endedAt).toBeLessThan(OPEN_ENTRY_END)
  })
})

describe('getDeletedActivities and restoreActivity', () => {
  it('lists only deleted activities, most-recently-deleted first', async () => {
    const live = await create('Sleeping')
    const first = await create('Deep Work')
    const second = await create('Exercise')
    await softDeleteActivity(first.id)
    await softDeleteActivity(second.id)

    const deleted = await getDeletedActivities()

    expect(deleted.map((a) => a.name)).toEqual(['Exercise', 'Deep Work'])
    expect(deleted).toHaveLength(2)
    // The live one is nowhere in the list.
    expect(deleted.some((a) => a.id === live.id)).toBe(false)
  })

  it('lifts the tombstone and bumps updatedAt so the restore wins the next sync', async () => {
    const activity = await create('Sleeping')
    await softDeleteActivity(activity.id)
    const deletedAt = (await db.activities.get(activity.id))?.updatedAt ?? 0

    await restoreActivity(activity.id)

    const restored = await db.activities.get(activity.id)
    expect(restored?.deletedAt).toBe(NOT_DELETED)
    expect(restored?.updatedAt).toBeGreaterThanOrEqual(deletedAt)
    // Back on the dashboard, and no longer in the deleted list.
    expect((await getActivities()).map((a) => a.name)).toEqual(['Sleeping'])
    expect(await getDeletedActivities()).toEqual([])
  })
})

describe('reorderActivities', () => {
  it('saves the new order', async () => {
    const first = await create('Sleeping')
    const second = await create('Deep Work')
    const third = await create('Exercise')

    await reorderActivities([third.id, first.id, second.id])

    expect((await getActivities()).map((a) => a.name)).toEqual([
      'Exercise',
      'Sleeping',
      'Deep Work',
    ])
  })
})
