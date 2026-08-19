import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getActivities, getDeletedActivities } from './activities.ts'
import { getCompletions } from './completions.ts'
import { db } from './db.ts'
import { getEntriesInRange } from './entries.ts'
import { seedSampleData } from './seed.ts'
import { displayMode, isOpen, OPEN_ENTRY_END } from './types.ts'
import { dateKey } from '../lib/time.ts'

// Pinned to America/Los_Angeles by vite.config.ts.
const now = new Date('2026-08-18T20:00:00-07:00').getTime()
const DAY = 24 * 60 * 60 * 1000

beforeEach(async () => {
  // `deleteAllData` writes a pref, and the node environment has no `localStorage`.
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })

  await db.delete()
  await db.open()
})

describe('seedSampleData', () => {
  it('writes a database with both card zones, an archive and a deletion', async () => {
    await seedSampleData(now)

    const visible = await getActivities()
    const all = await getActivities(true)
    const deleted = await getDeletedActivities()

    expect(visible.some((activity) => displayMode(activity) === 'habit')).toBe(true)
    expect(visible.some((activity) => displayMode(activity) === 'timer')).toBe(true)
    expect(all.length).toBeGreaterThan(visible.length)
    expect(deleted).toHaveLength(1)
  })

  it('is deterministic, so two runs write the same history', async () => {
    // Ids are not part of it: activities get a fresh uuid each time, exactly as they do when
    // the owner adds one. What repeats is which days were kept, cleared and tracked.
    const shape = async () => {
      const completions = await getCompletions()
      const entries = await getEntriesInRange(0, OPEN_ENTRY_END)
      return {
        days: completions.map((row) => `${row.day}:${row.done}`).sort(),
        stretches: entries.map((entry) => `${entry.startedAt}-${entry.endedAt}`).sort(),
      }
    }

    await seedSampleData(now)
    const first = await shape()

    await seedSampleData(now)

    expect(await shape()).toEqual(first)
  })

  it('replaces what was there rather than adding to it', async () => {
    await seedSampleData(now)
    const counts = await seedSampleData(now)

    expect(await db.activities.count()).toBe(counts.activities)
  })

  it('records nothing in the future and leaves no timer running', async () => {
    await seedSampleData(now)

    const entries = await getEntriesInRange(0, OPEN_ENTRY_END)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some(isOpen)).toBe(false)
    expect(Math.max(...entries.map((entry) => entry.endedAt))).toBeLessThanOrEqual(now)
  })

  it('leaves a day tracked but never ticked, which is what credits it from the clock', async () => {
    // The whole point of the hybrid activity in the seed: the check-off grid has to be showing
    // days no `Completion` row accounts for, or the credit path is not being exercised at all.
    await seedSampleData(now)

    const completions = await getCompletions()
    const ticked = new Set(completions.map((row) => `${row.activityId}:${row.day}`))
    const entries = await getEntriesInRange(now - 30 * DAY, OPEN_ENTRY_END)

    expect(
      entries.some((entry) => !ticked.has(`${entry.activityId}:${dateKey(entry.startedAt)}`)),
    ).toBe(true)
  })

  it('holds a stretch that crosses midnight, which window reads have to survive', async () => {
    await seedSampleData(now)

    const entries = await getEntriesInRange(0, OPEN_ENTRY_END)
    expect(
      entries.some((entry) => dateKey(entry.startedAt) !== dateKey(entry.endedAt)),
    ).toBe(true)
  })
})
