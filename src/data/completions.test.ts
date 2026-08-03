import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db.ts'
import {
  getCompletions,
  getCompletionsInRange,
  setCompletion,
  toggleCompletion,
} from './completions.ts'

beforeEach(async () => {
  await db.completions.clear()
})

describe('toggleCompletion', () => {
  it('records a day as done', async () => {
    expect(await toggleCompletion('a', '2026-08-03')).toBe(true)

    const rows = await getCompletions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ activityId: 'a', day: '2026-08-03', done: true })
  })

  it('leaves a `done: false` row behind rather than deleting the row', async () => {
    // The row is the record that a decision was made; only `done` says which way. Deleting
    // it would make "I cleared this day" indistinguishable from "I never touched it".
    await toggleCompletion('a', '2026-08-03')
    expect(await toggleCompletion('a', '2026-08-03')).toBe(false)

    const rows = await getCompletions()
    expect(rows).toHaveLength(1)
    expect(rows[0].done).toBe(false)
  })

  it('reads `false` back out of IndexedDB as `false`', async () => {
    // `done` is deliberately not indexed: a boolean is not a valid IndexedDB key, and a
    // record with one silently vanishes from that index.
    await setCompletion('a', '2026-08-03', false)
    const [row] = await getCompletions()
    expect(row.done).toBe(false)
    expect(row.done).not.toBeUndefined()
  })

  it('toggles back on from a cleared day', async () => {
    await toggleCompletion('a', '2026-08-03')
    await toggleCompletion('a', '2026-08-03')
    expect(await toggleCompletion('a', '2026-08-03')).toBe(true)
    expect(await getCompletions()).toHaveLength(1)
  })

  it('cannot produce two rows for one activity-day', async () => {
    await Promise.all([
      toggleCompletion('a', '2026-08-03'),
      toggleCompletion('a', '2026-08-03'),
      toggleCompletion('a', '2026-08-03'),
    ])
    expect(await getCompletions()).toHaveLength(1)
  })

  it('keeps different activities and different days apart', async () => {
    await toggleCompletion('a', '2026-08-03')
    await toggleCompletion('b', '2026-08-03')
    await toggleCompletion('a', '2026-08-04')
    expect(await getCompletions()).toHaveLength(3)
  })

  it('stamps updatedAt on every write', async () => {
    const before = Date.now()
    await toggleCompletion('a', '2026-08-03')
    const [first] = await getCompletions()
    expect(first.updatedAt).toBeGreaterThanOrEqual(before)

    await toggleCompletion('a', '2026-08-03')
    const [second] = await getCompletions()
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
  })
})

describe('getCompletionsInRange', () => {
  beforeEach(async () => {
    for (const day of ['2026-07-31', '2026-08-01', '2026-08-09', '2026-08-10']) {
      await toggleCompletion('a', day)
    }
  })

  it('includes both ends of the range', async () => {
    const rows = await getCompletionsInRange('2026-08-01', '2026-08-09')
    expect(rows.map((row) => row.day)).toEqual(['2026-08-01', '2026-08-09'])
  })

  it('orders by day, which zero-padded keys make chronological', async () => {
    const rows = await getCompletionsInRange('2026-01-01', '2026-12-31')
    expect(rows.map((row) => row.day)).toEqual([
      '2026-07-31',
      '2026-08-01',
      '2026-08-09',
      '2026-08-10',
    ])
  })

  it('returns cleared days too, so a streak can see the miss', async () => {
    await toggleCompletion('a', '2026-08-01')
    const rows = await getCompletionsInRange('2026-08-01', '2026-08-01')
    expect(rows).toHaveLength(1)
    expect(rows[0].done).toBe(false)
  })
})
