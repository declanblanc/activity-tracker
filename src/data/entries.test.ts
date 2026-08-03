// The two reads below are the ones that fail *silently* when written the obvious
// way: a null `endedAt` disappears from its index, and a window anchored on
// `startedAt` drops intervals that began before the window. Both need a real
// IndexedDB to catch, so this suite runs against an in-memory one.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db.ts'
import {
  getEntriesForActivity,
  getEntriesInRange,
  getEntry,
  getOpenEntries,
  MIN_TRACKED_MS,
  reassignEntry,
  saveEntry,
  softDeleteEntry,
  startActivity,
  stopActivity,
} from './entries.ts'
import { NOT_DELETED, OPEN_ENTRY_END, isOpen, newId, type Entry } from './types.ts'

const HOUR = 60 * 60 * 1000
const DAY_START = Date.UTC(2026, 0, 15)
const DAY_END = DAY_START + 24 * HOUR

function entry(fields: Partial<Entry>): Entry {
  return {
    id: newId(),
    activityId: 'activity-1',
    startedAt: DAY_START,
    endedAt: DAY_START + HOUR,
    createdAt: DAY_START,
    updatedAt: DAY_START,
    deletedAt: NOT_DELETED,
    ...fields,
  }
}

beforeEach(async () => {
  await db.entries.clear()
})

describe('getOpenEntries', () => {
  it('finds an open entry through the endedAt index', async () => {
    const open = entry({ endedAt: OPEN_ENTRY_END })
    await db.entries.bulkAdd([open, entry({})])

    expect(await getOpenEntries()).toEqual([open])
  })

  it('ignores a soft-deleted open entry', async () => {
    await db.entries.add(entry({ endedAt: OPEN_ENTRY_END, deletedAt: DAY_START }))

    expect(await getOpenEntries()).toEqual([])
  })
})

describe('getEntriesInRange', () => {
  it('includes an interval that started before the window and ended inside it', async () => {
    const sleep = entry({ startedAt: DAY_START - HOUR, endedAt: DAY_START + 7 * HOUR })
    await db.entries.add(sleep)

    expect(await getEntriesInRange(DAY_START, DAY_END)).toEqual([sleep])
  })

  it('includes an interval spanning the window end to end, and open entries', async () => {
    const spanning = entry({ startedAt: DAY_START - HOUR, endedAt: DAY_END + HOUR })
    const open = entry({ startedAt: DAY_START + HOUR, endedAt: OPEN_ENTRY_END })
    await db.entries.bulkAdd([spanning, open])

    expect(await getEntriesInRange(DAY_START, DAY_END)).toEqual([spanning, open])
  })

  it('excludes intervals that only touch the window bounds', async () => {
    await db.entries.bulkAdd([
      entry({ startedAt: DAY_START - HOUR, endedAt: DAY_START }),
      entry({ startedAt: DAY_END, endedAt: DAY_END + HOUR }),
    ])

    expect(await getEntriesInRange(DAY_START, DAY_END)).toEqual([])
  })

  it('excludes soft-deleted entries', async () => {
    await db.entries.add(entry({ deletedAt: DAY_END }))

    expect(await getEntriesInRange(DAY_START, DAY_END)).toEqual([])
  })
})

describe('getEntriesForActivity', () => {
  it('returns only the named activity, on the same endedAt-anchored window rule', async () => {
    const mine = entry({ startedAt: DAY_START - HOUR, endedAt: DAY_START + HOUR })
    await db.entries.bulkAdd([mine, entry({ activityId: 'activity-2' })])

    expect(await getEntriesForActivity('activity-1', DAY_START, DAY_END)).toEqual([mine])
  })

  it('includes the activity’s open entry and excludes its tombstones', async () => {
    const open = entry({ endedAt: OPEN_ENTRY_END })
    await db.entries.bulkAdd([open, entry({ deletedAt: DAY_END })])

    expect(await getEntriesForActivity('activity-1', DAY_START, DAY_END)).toEqual([open])
  })
})

describe('getEntry', () => {
  it('reads a live entry and hides a soft-deleted one', async () => {
    const live = entry({})
    const gone = entry({ deletedAt: DAY_END })
    await db.entries.bulkAdd([live, gone])

    expect(await getEntry(live.id)).toEqual(live)
    expect(await getEntry(gone.id)).toBeUndefined()
  })
})

describe('startActivity', () => {
  it('opens an entry starting at the given time', async () => {
    const started = await startActivity('activity-1', DAY_START)

    expect(started.startedAt).toBe(DAY_START)
    expect(isOpen(started)).toBe(true)
    expect(await getOpenEntries()).toEqual([started])
  })

  it('reuses the open entry instead of opening a second one', async () => {
    const first = await startActivity('activity-1', DAY_START)
    const again = await startActivity('activity-1', DAY_START + HOUR)

    expect(again.id).toBe(first.id)
    expect(again.startedAt).toBe(DAY_START)
    expect(await getOpenEntries()).toHaveLength(1)
  })

  it('holds the invariant under concurrent calls', async () => {
    await Promise.all([startActivity('activity-1'), startActivity('activity-1')])

    expect(await getOpenEntries()).toHaveLength(1)
  })

  it('opens a fresh entry after the previous one was closed', async () => {
    const first = await startActivity('activity-1', DAY_START)
    await stopActivity('activity-1', DAY_START + HOUR)
    const second = await startActivity('activity-1', DAY_START + 2 * HOUR)

    expect(second.id).not.toBe(first.id)
    expect(await getOpenEntries()).toEqual([second])
  })

  it('lets two activities run at once without either interval displacing the other', async () => {
    const one = await startActivity('activity-1', DAY_START)
    await startActivity('activity-2', DAY_START + HOUR)
    await stopActivity('activity-2', DAY_START + 2 * HOUR)

    expect(await db.entries.get(one.id)).toEqual(one)
    expect(await getOpenEntries()).toEqual([one])
  })
})

describe('stopActivity below the tracking floor', () => {
  it('keeps a stretch of exactly the floor', async () => {
    const started = await startActivity('activity-1', DAY_START)
    const { discarded } = await stopActivity('activity-1', DAY_START + MIN_TRACKED_MS)

    expect(discarded).toBe(false)
    expect(await getEntry(started.id)).toMatchObject({ endedAt: DAY_START + MIN_TRACKED_MS })
  })

  it('discards a stretch one millisecond under it, and says so', async () => {
    const started = await startActivity('activity-1', DAY_START)
    const { discarded } = await stopActivity('activity-1', DAY_START + MIN_TRACKED_MS - 1)

    expect(discarded).toBe(true)
    // Gone from every read, but still a closed row carrying a tombstone rather than a
    // physically removed one.
    expect(await getEntry(started.id)).toBeUndefined()
    expect(await getOpenEntries()).toEqual([])
    const raw = await db.entries.get(started.id)
    expect(raw?.endedAt).toBe(DAY_START + MIN_TRACKED_MS - 1)
    expect(raw?.deletedAt).not.toBe(NOT_DELETED)
  })

  it('leaves a discarded stretch out of the totals a window reports', async () => {
    await startActivity('activity-1', DAY_START)
    await stopActivity('activity-1', DAY_START + 10_000)

    expect(await getEntriesInRange(DAY_START, DAY_END)).toEqual([])
  })

  it('discards an inverted stretch rather than keeping a negative interval', async () => {
    await startActivity('activity-1', DAY_START + HOUR)
    const { discarded } = await stopActivity('activity-1', DAY_START)

    expect(discarded).toBe(true)
  })

  it('reports nothing discarded when no timer was running', async () => {
    expect(await stopActivity('activity-1', DAY_START)).toEqual({ discarded: false })
  })
})

describe('saveEntry', () => {
  const input = {
    activityId: 'activity-1',
    startedAt: DAY_START + HOUR,
    endedAt: DAY_START + 2 * HOUR,
  }

  it('inserts a manual entry and stamps the timestamp trio', async () => {
    const saved = await saveEntry({ ...input, note: 'forgotten run' })

    expect(saved.note).toBe('forgotten run')
    expect(saved.createdAt).toBe(saved.updatedAt)
    expect(await getEntry(saved.id)).toEqual(saved)
  })

  it('updates in place, keeping createdAt and refreshing updatedAt', async () => {
    const stored = entry({ note: 'first' })
    await db.entries.add(stored)

    const saved = await saveEntry({ ...input, id: stored.id, note: 'corrected' })

    expect(saved.id).toBe(stored.id)
    expect(saved.createdAt).toBe(stored.createdAt)
    expect(saved.updatedAt).toBeGreaterThan(stored.updatedAt)
    expect(saved.endedAt).toBe(input.endedAt)
  })

  it('stores no note at all when the note is cleared', async () => {
    const stored = entry({ note: 'first' })
    await db.entries.add(stored)

    const saved = await saveEntry({ ...input, id: stored.id, note: '  ' })

    expect(saved).not.toHaveProperty('note')
    expect(await db.entries.get(stored.id)).not.toHaveProperty('note')
  })

  it('closes an open entry when an end time is supplied', async () => {
    const open = await startActivity('activity-1', DAY_START)

    const saved = await saveEntry({ ...input, id: open.id, startedAt: DAY_START })

    expect(isOpen(saved)).toBe(false)
    expect(await getOpenEntries()).toEqual([])
  })

  it('leaves an open entry open when its note is edited', async () => {
    const open = await startActivity('activity-1', DAY_START)

    const saved = await saveEntry({
      activityId: open.activityId,
      id: open.id,
      startedAt: open.startedAt,
      endedAt: OPEN_ENTRY_END,
      note: 'still going',
    })

    expect(isOpen(saved)).toBe(true)
    expect(await getOpenEntries()).toEqual([saved])
  })

  it('takes null as "still running" from a caller outside src/data', async () => {
    const open = await startActivity('activity-1', DAY_START)

    const saved = await saveEntry({
      activityId: open.activityId,
      id: open.id,
      startedAt: DAY_START + HOUR,
      endedAt: null,
    })

    expect(isOpen(saved)).toBe(true)
    expect(saved.startedAt).toBe(DAY_START + HOUR)
  })

  it('refuses to reopen a closed entry, by null or by the sentinel', async () => {
    const stored = entry({})
    await db.entries.add(stored)

    await expect(saveEntry({ ...input, id: stored.id, endedAt: null })).rejects.toThrow(
      'Enter an end time.',
    )
    await expect(
      saveEntry({ ...input, id: stored.id, endedAt: OPEN_ENTRY_END }),
    ).rejects.toThrow('Enter an end time.')
  })

  it('refuses to insert an entry with no end at all', async () => {
    await expect(saveEntry({ ...input, endedAt: null })).rejects.toThrow('Enter an end time.')
  })

  it('rejects a zero-length interval', async () => {
    await expect(saveEntry({ ...input, endedAt: input.startedAt })).rejects.toThrow(
      'zero minutes',
    )
  })

  it('rejects an end before the start', async () => {
    await expect(saveEntry({ ...input, endedAt: input.startedAt - HOUR })).rejects.toThrow(
      'must be after',
    )
  })

  it('rejects a half-typed time and a missing activity', async () => {
    await expect(saveEntry({ ...input, endedAt: NaN })).rejects.toThrow('Enter an end time.')
    await expect(saveEntry({ ...input, activityId: '' })).rejects.toThrow('Choose an activity.')
  })

  it('refuses to edit an entry that has been deleted', async () => {
    const gone = entry({ deletedAt: DAY_END })
    await db.entries.add(gone)

    await expect(saveEntry({ ...input, id: gone.id })).rejects.toThrow('no longer exists')
  })
})

describe('saveEntry same-activity merge', () => {
  it('folds strictly overlapping intervals into one, soft-deleting the absorbed record', async () => {
    const earlier = entry({ startedAt: DAY_START + 9 * HOUR, endedAt: DAY_START + 12 * HOUR })
    await db.entries.add(earlier)

    const saved = await saveEntry({
      activityId: 'activity-1',
      startedAt: DAY_START + 11 * HOUR,
      endedAt: DAY_START + 14 * HOUR,
    })

    expect(saved.startedAt).toBe(DAY_START + 9 * HOUR)
    expect(saved.endedAt).toBe(DAY_START + 14 * HOUR)
    expect(await getEntry(earlier.id)).toBeUndefined()
    expect(await getEntriesForActivity('activity-1', DAY_START, DAY_END)).toEqual([saved])
  })

  it('leaves intervals that only touch end-to-start as two records', async () => {
    const morning = entry({ startedAt: DAY_START + 9 * HOUR, endedAt: DAY_START + 12 * HOUR })
    await db.entries.add(morning)

    const afternoon = await saveEntry({
      activityId: 'activity-1',
      startedAt: DAY_START + 12 * HOUR,
      endedAt: DAY_START + 14 * HOUR,
    })

    expect(await getEntriesForActivity('activity-1', DAY_START, DAY_END)).toEqual([
      morning,
      afternoon,
    ])
  })

  it('never merges across activities', async () => {
    const other = entry({
      activityId: 'activity-2',
      startedAt: DAY_START + 9 * HOUR,
      endedAt: DAY_START + 12 * HOUR,
    })
    await db.entries.add(other)

    const saved = await saveEntry({
      activityId: 'activity-1',
      startedAt: DAY_START + 10 * HOUR,
      endedAt: DAY_START + 11 * HOUR,
    })

    expect(saved.startedAt).toBe(DAY_START + 10 * HOUR)
    expect(await getEntry(other.id)).toEqual(other)
  })

  it('keeps the open entry running when an edit overlaps it', async () => {
    const closed = entry({ startedAt: DAY_START + 9 * HOUR, endedAt: DAY_START + 12 * HOUR })
    await db.entries.add(closed)
    const open = await startActivity('activity-1', DAY_START + 11 * HOUR)

    const saved = await saveEntry({
      activityId: 'activity-1',
      id: closed.id,
      startedAt: closed.startedAt,
      endedAt: closed.endedAt,
    })

    expect(saved.id).toBe(open.id)
    expect(isOpen(saved)).toBe(true)
    expect(saved.startedAt).toBe(DAY_START + 9 * HOUR)
    expect(await getOpenEntries()).toEqual([saved])
    expect(await getEntry(closed.id)).toBeUndefined()
  })

  it('absorbs a record that only the widened span reaches', async () => {
    const early = entry({ startedAt: DAY_START + 8 * HOUR, endedAt: DAY_START + 9.5 * HOUR })
    const middle = entry({ startedAt: DAY_START + 9 * HOUR, endedAt: DAY_START + 10.5 * HOUR })
    await db.entries.bulkAdd([early, middle])

    // 10:00–11:00 overlaps only `middle`; absorbing it reaches back to 09:00, which
    // then overlaps `early`.
    const saved = await saveEntry({
      activityId: 'activity-1',
      startedAt: DAY_START + 10 * HOUR,
      endedAt: DAY_START + 11 * HOUR,
    })

    expect(saved.startedAt).toBe(DAY_START + 8 * HOUR)
    expect(saved.endedAt).toBe(DAY_START + 11 * HOUR)
    expect(await getEntriesForActivity('activity-1', DAY_START, DAY_END)).toEqual([saved])
  })
})

describe('reassignEntry', () => {
  it('moves the entry, leaving its interval and note untouched', async () => {
    const stored = entry({ note: 'wrong toggle' })
    await db.entries.add(stored)

    const moved = await reassignEntry(stored.id, 'activity-2')

    expect(moved.activityId).toBe('activity-2')
    expect(moved.startedAt).toBe(stored.startedAt)
    expect(moved.endedAt).toBe(stored.endedAt)
    expect(moved.note).toBe('wrong toggle')
    expect(moved.updatedAt).toBeGreaterThan(stored.updatedAt)
    expect(await getEntriesForActivity('activity-1', DAY_START, DAY_END)).toEqual([])
  })

  it('merges when the entry lands on an interval the destination already has', async () => {
    const destination = entry({
      activityId: 'activity-2',
      startedAt: DAY_START + 9 * HOUR,
      endedAt: DAY_START + 12 * HOUR,
    })
    const stray = entry({ startedAt: DAY_START + 11 * HOUR, endedAt: DAY_START + 14 * HOUR })
    await db.entries.bulkAdd([destination, stray])

    const moved = await reassignEntry(stray.id, 'activity-2')

    expect(moved.startedAt).toBe(DAY_START + 9 * HOUR)
    expect(moved.endedAt).toBe(DAY_START + 14 * HOUR)
    expect(await getEntriesForActivity('activity-2', DAY_START, DAY_END)).toEqual([moved])
  })

  it('refuses to move an entry that has been deleted', async () => {
    const gone = entry({ deletedAt: DAY_END })
    await db.entries.add(gone)

    await expect(reassignEntry(gone.id, 'activity-2')).rejects.toThrow('no longer exists')
  })
})

describe('softDeleteEntry', () => {
  it('hides the entry from every read but keeps the record as a tombstone', async () => {
    const open = await startActivity('activity-1', DAY_START)

    await softDeleteEntry(open.id)

    expect(await getOpenEntries()).toEqual([])
    expect(await getEntriesInRange(DAY_START, DAY_END)).toEqual([])
    expect(await getEntry(open.id)).toBeUndefined()
    expect(await db.entries.get(open.id)).toMatchObject({ id: open.id })
    expect((await db.entries.get(open.id))?.deletedAt).not.toBe(NOT_DELETED)
  })
})
