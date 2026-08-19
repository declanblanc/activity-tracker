import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db.ts'
import { getCompletions, getCompletionsInRange, setCompletion } from './completions.ts'

beforeEach(async () => {
  await db.completions.clear()
})

describe('setCompletion', () => {
  it('records a day as done', async () => {
    await setCompletion('a', '2026-08-03', true)

    const rows = await getCompletions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ activityId: 'a', day: '2026-08-03', done: true })
  })

  it('leaves a `done: false` row behind rather than deleting the row', async () => {
    // The row is the record that a decision was made; only `done` says which way. Deleting
    // it would make "I cleared this day" indistinguishable from "I never touched it".
    await setCompletion('a', '2026-08-03', true)
    await setCompletion('a', '2026-08-03', false)

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

  it('sets a cleared day back on', async () => {
    await setCompletion('a', '2026-08-03', true)
    await setCompletion('a', '2026-08-03', false)
    await setCompletion('a', '2026-08-03', true)

    const rows = await getCompletions()
    expect(rows).toHaveLength(1)
    expect(rows[0].done).toBe(true)
  })

  it('cannot produce two rows for one activity-day', async () => {
    await Promise.all([
      setCompletion('a', '2026-08-03', true),
      setCompletion('a', '2026-08-03', false),
      setCompletion('a', '2026-08-03', true),
    ])
    expect(await getCompletions()).toHaveLength(1)
  })

  it('keeps different activities and different days apart', async () => {
    await setCompletion('a', '2026-08-03', true)
    await setCompletion('b', '2026-08-03', true)
    await setCompletion('a', '2026-08-04', true)
    expect(await getCompletions()).toHaveLength(3)
  })

  it('stamps updatedAt on every write', async () => {
    const before = Date.now()
    await setCompletion('a', '2026-08-03', true)
    const [first] = await getCompletions()
    expect(first.updatedAt).toBeGreaterThanOrEqual(before)

    await setCompletion('a', '2026-08-03', false)
    const [second] = await getCompletions()
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
  })
})

describe('getCompletionsInRange', () => {
  beforeEach(async () => {
    for (const day of ['2026-07-31', '2026-08-01', '2026-08-09', '2026-08-10']) {
      await setCompletion('a', day, true)
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
    await setCompletion('a', '2026-08-01', false)
    const rows = await getCompletionsInRange('2026-08-01', '2026-08-01')
    expect(rows).toHaveLength(1)
    expect(rows[0].done).toBe(false)
  })
})
