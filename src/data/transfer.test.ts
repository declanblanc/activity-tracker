// Export and import are the two places the sentinel encoding crosses out of `data/`,
// and the only place a whole database is written in one go. Both failure modes are
// quiet: a sentinel that leaks reads as an entry ending in the year 287396, and a
// half-applied import corrupts the record it was meant to restore. The round-trip and
// the rejections are therefore exercised against a real (in-memory) IndexedDB.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db.ts'
import {
  FORMAT_VERSION,
  escapeCsv,
  exportCsv,
  exportJson,
  importJson,
  parseTransferFile,
  restoreJson,
  winner,
  type TransferFile,
} from './transfer.ts'
import {
  NOT_DELETED,
  OPEN_ENTRY_END,
  completionId,
  type Activity,
  type Completion,
  type Entry,
} from './types.ts'

const HOUR = 60 * 60 * 1000
const T0 = Date.UTC(2026, 0, 15, 8)

function activity(fields: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1',
    name: 'Work',
    color: '#38bdf8',
    measure: 'duration',
    archived: false,
    sortOrder: 0,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: NOT_DELETED,
    ...fields,
  }
}

function entry(fields: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1',
    activityId: 'activity-1',
    startedAt: T0,
    endedAt: T0 + HOUR,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: NOT_DELETED,
    ...fields,
  }
}

function completion(fields: Partial<Completion> = {}): Completion {
  const activityId = fields.activityId ?? 'habit-1'
  const day = fields.day ?? '2026-01-15'
  return {
    id: completionId(activityId, day),
    activityId,
    day,
    done: true,
    updatedAt: T0,
    ...fields,
  }
}

const parseExport = async () => JSON.parse(await exportJson()) as TransferFile

/** A file the validator accepts, so each test can break exactly one thing. */
function file(overrides: Partial<TransferFile> = {}): string {
  return JSON.stringify({
    formatVersion: FORMAT_VERSION,
    exportedAt: T0,
    activities: [{ ...activity(), deletedAt: null }],
    entries: [{ ...entry(), endedAt: T0 + HOUR, note: null, deletedAt: null }],
    completions: [],
    ...overrides,
  })
}

beforeEach(async () => {
  await db.activities.clear()
  await db.entries.clear()
  await db.completions.clear()
})

describe('exportJson', () => {
  it('writes null, not the sentinels, for an open entry and a live record', async () => {
    await db.activities.add(activity())
    await db.entries.add(entry({ endedAt: OPEN_ENTRY_END }))

    const exported = await parseExport()

    expect(exported.formatVersion).toBe(FORMAT_VERSION)
    expect(exported.entries[0].endedAt).toBeNull()
    expect(exported.entries[0].deletedAt).toBeNull()
    expect(exported.activities[0].deletedAt).toBeNull()
  })

  it('includes tombstones so a re-import does not resurrect deleted records', async () => {
    await db.activities.add(activity({ deletedAt: T0 + HOUR }))
    await db.entries.add(entry({ deletedAt: T0 + HOUR }))

    const exported = await parseExport()

    expect(exported.activities[0].deletedAt).toBe(T0 + HOUR)
    expect(exported.entries[0].deletedAt).toBe(T0 + HOUR)
  })

  it('round-trips an open entry, a tombstone and a note through an empty database', async () => {
    await db.activities.add(activity())
    await db.entries.bulkAdd([
      entry({ id: 'closed', note: 'wrote the thing' }),
      entry({ id: 'open', endedAt: OPEN_ENTRY_END }),
      entry({ id: 'deleted', deletedAt: T0 + HOUR }),
    ])
    const backup = await exportJson()
    const before = await db.entries.orderBy('id').toArray()

    await db.activities.clear()
    await db.entries.clear()
    await importJson(backup)

    expect(await db.entries.orderBy('id').toArray()).toEqual(before)
    expect(await db.activities.toArray()).toEqual([activity()])
  })
})

describe('exportCsv', () => {
  it('names the activity and gives a parseable duration', async () => {
    await db.activities.add(activity())
    await db.entries.add(entry())

    const [header, row] = (await exportCsv()).split('\n')

    expect(header).toBe('activity,measure,date,started,ended,duration_minutes,note')
    expect(row.split(',')).toEqual([
      'Work',
      'duration',
      '2026-01-15',
      '2026-01-15 00:00',
      '2026-01-15 01:00',
      '60',
      '',
    ])
  })

  it('leaves the end and duration of a running entry blank', async () => {
    await db.activities.add(activity())
    await db.entries.add(entry({ endedAt: OPEN_ENTRY_END }))

    const row = (await exportCsv()).split('\n')[1]

    expect(row.endsWith(',,,')).toBe(true)
  })

  it('omits soft-deleted entries', async () => {
    await db.activities.add(activity())
    await db.entries.add(entry({ deletedAt: T0 }))

    expect((await exportCsv()).split('\n')).toHaveLength(1)
  })

  it('quotes a note so commas, quotes and newlines cannot shift a column', () => {
    expect(escapeCsv('plain')).toBe('plain')
    expect(escapeCsv('a, b')).toBe('"a, b"')
    expect(escapeCsv('she said "hi"')).toBe('"she said ""hi"""')
    expect(escapeCsv('two\nlines')).toBe('"two\nlines"')
  })
})

describe('parseTransferFile', () => {
  const rejects = (text: string, match: RegExp) => expect(() => parseTransferFile(text)).toThrow(match)

  it('rejects a file from a newer build rather than applying part of it', () => {
    rejects(file({ formatVersion: FORMAT_VERSION + 1 }), /newer version/)
  })

  it('rejects text that is not an export', () => {
    rejects('not json at all', /not valid JSON/)
    rejects('{"hello":true}', /not an Activity Tracker export/)
    rejects(file({ entries: undefined }), /missing its activities or entries/)
  })

  it('rejects records with missing or unreadable fields', () => {
    rejects(file({ activities: [{ ...activity(), name: '' }] as never }), /Activity 1 has no name/)
    rejects(
      file({ activities: [{ ...activity(), updatedAt: 'soon' }] as never }),
      /Activity 1 has no updatedAt/,
    )
    rejects(file({ entries: [{ ...entry(), activityId: null }] as never }), /Entry 1 has no activity/)
    rejects(
      file({ entries: [{ ...entry(), endedAt: T0 - HOUR }] as never }),
      /Entry 1 ends before it starts/,
    )
  })

  it('accepts an entry that is still running', () => {
    expect(parseTransferFile(file()).entries).toHaveLength(1)
    expect(() => parseTransferFile(file({ entries: [{ ...entry(), endedAt: null }] as never })))
      .not.toThrow()
  })
})

describe('winner', () => {
  const local = { id: 'a', updatedAt: 2 }
  const remote = { id: 'b', updatedAt: 1 }

  it('takes the newer updatedAt in either direction', () => {
    expect(winner(local, remote)).toBe(local)
    expect(winner(remote, local)).toBe(local)
  })

  it('breaks a tie on the greater id, so both devices pick the same record', () => {
    const tied = { id: 'b', updatedAt: 2 }
    expect(winner(local, tied)).toBe(tied)
    expect(winner(tied, local)).toBe(tied)
  })
})

describe('importJson', () => {
  it('writes nothing at all when the file is malformed', async () => {
    await db.entries.add(entry({ note: 'original' }))

    await expect(importJson(file({ entries: [{ ...entry(), startedAt: 'noon' }] as never })))
      .rejects.toThrow(/Entry 1 has no start time/)

    expect((await db.entries.get('entry-1'))?.note).toBe('original')
    expect(await db.activities.count()).toBe(0)
  })

  it('keeps the record with the newer updatedAt', async () => {
    await db.entries.add(entry({ note: 'newer local', updatedAt: T0 + HOUR }))
    await db.activities.add(activity({ name: 'older local', updatedAt: T0 - HOUR }))

    await importJson(file())

    expect((await db.entries.get('entry-1'))?.note).toBe('newer local')
    expect((await db.activities.get('activity-1'))?.name).toBe('Work')
  })

  it('stores an imported open entry as open', async () => {
    await importJson(file({ entries: [{ ...entry(), endedAt: null }] as never }))

    expect((await db.entries.get('entry-1'))?.endedAt).toBe(OPEN_ENTRY_END)
  })

  // Refusing the batch would wedge sync permanently: the same pair arrives on every later
  // attempt. The later start stays open and the earlier one is closed where it began.
  it('closes the earlier timer when an import would leave two open for one activity', async () => {
    await db.entries.add(entry({ id: 'local-open', startedAt: T0, endedAt: OPEN_ENTRY_END }))

    await importJson(
      file({
        entries: [
          { ...entry(), id: 'imported-open', startedAt: T0 + HOUR, endedAt: null },
        ] as never,
      }),
    )

    expect((await db.entries.get('local-open'))?.endedAt).toBe(T0 + HOUR)
    expect((await db.entries.get('imported-open'))?.endedAt).toBe(OPEN_ENTRY_END)
  })

  // Identical starts leave no interval to close, and an entry may not end when it begins.
  it('tombstones the duplicate when two open timers share a start instant', async () => {
    await db.entries.add(entry({ id: 'local-open', startedAt: T0, endedAt: OPEN_ENTRY_END }))

    await importJson(
      file({
        entries: [{ ...entry(), id: 'imported-open', startedAt: T0, endedAt: null }] as never,
      }),
    )

    const local = await db.entries.get('local-open')
    expect(local?.deletedAt).not.toBe(NOT_DELETED)
    expect((await db.entries.get('imported-open'))?.endedAt).toBe(OPEN_ENTRY_END)
  })

  it('allows an open entry to replace the one it is a backup of', async () => {
    await db.entries.add(entry({ endedAt: OPEN_ENTRY_END, note: 'stale', updatedAt: T0 }))

    await importJson(
      file({
        entries: [{ ...entry(), endedAt: null, note: 'restored', updatedAt: T0 + HOUR }] as never,
      }),
    )

    expect((await db.entries.get('entry-1'))?.note).toBe('restored')
  })

  it('allows an import that closes the locally open entry', async () => {
    await db.entries.add(entry({ endedAt: OPEN_ENTRY_END, updatedAt: T0 }))

    await importJson(
      file({
        entries: [
          { ...entry(), endedAt: T0 + HOUR, updatedAt: T0 + HOUR },
          { ...entry(), id: 'other-open', endedAt: null, updatedAt: T0 + HOUR },
        ] as never,
      }),
    )

    expect((await db.entries.get('entry-1'))?.endedAt).toBe(T0 + HOUR)
    expect((await db.entries.get('other-open'))?.endedAt).toBe(OPEN_ENTRY_END)
  })
})

describe('completions across the file boundary', () => {
  it('round-trips `done: false` through JSON in both directions', async () => {
    // The highest-value assertion in this file. A cleared day is a recorded decision, and
    // `done ?? true` or `!!done` anywhere on either path would turn it back into a
    // completed one — silently rewriting history on every backup restore.
    await db.completions.bulkAdd([
      completion({ day: '2026-01-15', done: true }),
      completion({ day: '2026-01-16', done: false }),
    ])
    const backup = await exportJson()
    const before = await db.completions.orderBy('id').toArray()

    await db.completions.clear()
    await importJson(backup)

    expect(await db.completions.orderBy('id').toArray()).toEqual(before)
    expect((await db.completions.get(completionId('habit-1', '2026-01-16')))?.done).toBe(false)
  })

  it('exports cleared days rather than dropping them', async () => {
    await db.completions.add(completion({ done: false }))
    const exported = await parseExport()
    expect(exported.completions).toHaveLength(1)
    expect(exported.completions[0].done).toBe(false)
  })

  it('rejects a check-off whose done is not a boolean', async () => {
    expect(() =>
      parseTransferFile(file({ completions: [{ ...completion(), done: 'yes' }] as never })),
    ).toThrow(/Check-off 1 does not say whether it was done/)
    expect(() =>
      parseTransferFile(file({ completions: [{ ...completion(), done: undefined }] as never })),
    ).toThrow(/Check-off 1 does not say whether it was done/)
  })

  it('rejects a check-off with no usable day', async () => {
    expect(() =>
      parseTransferFile(file({ completions: [{ ...completion(), day: '15/01/2026' }] as never })),
    ).toThrow(/Check-off 1 has no day/)
  })

  it('accepts a file with no completions key at all', () => {
    expect(parseTransferFile(file({ completions: undefined })).completions).toEqual([])
  })

  it('recomputes the id rather than trusting the file’s', async () => {
    // A mismatched id would otherwise let one activity-day hold two rows.
    await importJson(
      file({
        completions: [
          { ...completion({ day: '2026-01-15' }), id: 'nonsense' },
          { ...completion({ day: '2026-01-15' }), id: 'also-nonsense' },
        ] as never,
      }),
    )

    const rows = await db.completions.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(completionId('habit-1', '2026-01-15'))
  })

  it('keeps the newer check-off when the day already exists locally', async () => {
    // Last write wins per day, which is what makes re-importing a stale backup safe: it
    // cannot roll back a day that was cleared after the backup was taken.
    await db.completions.add(completion({ day: '2026-01-15', done: false, updatedAt: T0 + HOUR }))

    await importJson(
      file({ completions: [completion({ day: '2026-01-15', done: true, updatedAt: T0 })] }),
    )

    expect((await db.completions.get(completionId('habit-1', '2026-01-15')))?.done).toBe(false)
  })

  it('takes the incoming check-off when it is the newer one', async () => {
    await db.completions.add(completion({ day: '2026-01-15', done: false, updatedAt: T0 }))

    await importJson(
      file({
        completions: [completion({ day: '2026-01-15', done: true, updatedAt: T0 + HOUR })],
      }),
    )

    expect((await db.completions.get(completionId('habit-1', '2026-01-15')))?.done).toBe(true)
  })

  it('is idempotent: importing the same file twice changes nothing', async () => {
    const text = file({
      completions: [completion({ day: '2026-01-15' }), completion({ day: '2026-01-16' })],
    })
    await importJson(text)
    const after = await db.completions.orderBy('id').toArray()

    await importJson(text)

    expect(await db.completions.orderBy('id').toArray()).toEqual(after)
  })

  it('writes no completions when the file is malformed elsewhere', async () => {
    await expect(
      importJson(
        file({
          entries: [{ ...entry(), startedAt: 'noon' }] as never,
          completions: [completion()],
        }),
      ),
    ).rejects.toThrow(/Entry 1 has no start time/)

    expect(await db.completions.count()).toBe(0)
  })

  it('reports how many of each record it wrote', async () => {
    const result = await importJson(file({ completions: [completion()] }))
    expect(result).toEqual({ activities: 1, entries: 1, completions: 1 })
  })

  it('gives a check-off a CSV row with the interval columns blank', async () => {
    await db.activities.add(activity({ id: 'habit-1', name: 'Stretch', measure: 'count' }))
    await db.completions.add(completion({ day: '2026-01-15' }))

    const [, row] = (await exportCsv()).split('\n')

    expect(row.split(',')).toEqual(['Stretch', 'count', '2026-01-15', '', '', '', ''])
  })

  it('omits a cleared day from the CSV, as it omits a deleted entry', async () => {
    await db.activities.add(activity({ id: 'habit-1', measure: 'count' }))
    await db.completions.add(completion({ done: false }))

    expect((await exportCsv()).split('\n')).toHaveLength(1)
  })

  it('orders check-offs and entries together by when they happened', async () => {
    await db.activities.bulkAdd([
      activity({ id: 'activity-1', name: 'Work' }),
      activity({ id: 'habit-1', name: 'Stretch', measure: 'count' }),
    ])
    await db.entries.add(entry({ startedAt: T0, endedAt: T0 + HOUR }))
    await db.completions.add(completion({ day: '2026-01-14' }))

    const rows = (await exportCsv()).split('\n').slice(1)

    expect(rows.map((row) => row.split(',')[0])).toEqual(['Stretch', 'Work'])
  })
})

describe('restoreJson', () => {
  it('brings back a record deleted after the backup was made', async () => {
    // The account has the activity deleted, with a newer stamp than the backup — exactly the case
    // where importJson keeps the tombstone and the backup is a silent no-op.
    await db.activities.add(activity({ deletedAt: T0 + HOUR, updatedAt: T0 + HOUR }))

    const before = Date.now()
    await restoreJson(file())

    const restored = await db.activities.get('activity-1')
    expect(restored?.deletedAt).toBe(NOT_DELETED)
    // Restamped to now, so the restore also beats the tombstone on the next sync, not only here.
    expect(restored?.updatedAt).toBeGreaterThanOrEqual(before)
    expect(restored?.updatedAt).toBeGreaterThan(T0 + HOUR)
  })

  it('drops a record the backup does not contain', async () => {
    await db.activities.add(activity({ id: 'extra', name: 'Not in backup' }))

    await restoreJson(file())

    expect(await db.activities.get('extra')).toBeUndefined()
    expect(await db.activities.count()).toBe(1)
  })

  it('reports how many of each record it wrote', async () => {
    const result = await restoreJson(file({ completions: [completion()] }))
    expect(result).toEqual({ activities: 1, entries: 1, completions: 1 })
  })
})
