/**
 * The file boundary: JSON backup out, JSON backup in, CSV out.
 *
 * On disk both absences are `null` — `endedAt: null` for a running entry, `deletedAt: null`
 * for a live record — so a backup file is readable without knowing the sentinel encoding
 * `types.ts` documents. This module is the only place that translation happens.
 *
 * Completions need no such translation, which is a small dividend of `done: false` being
 * their tombstone rather than a `deletedAt`.
 *
 * Tombstones are exported too, so a re-import round-trips exactly rather than resurrecting
 * everything the owner has deleted.
 */

import { parseKey, toDateTimeInput } from '../lib/time.ts'
import { db } from './db.ts'
import {
  NOT_DELETED,
  OPEN_ENTRY_END,
  completionId,
  isLive,
  type Activity,
  type Completion,
  type Entry,
  type Measure,
  type Period,
} from './types.ts'

/** Bumped only when the on-disk shape changes in a way an older build cannot read. */
export const FORMAT_VERSION = 1

/** An `Activity` as written to disk: `deletedAt` is `null` when the record is live. */
type ExportedActivity = Omit<Activity, 'deletedAt'> & { deletedAt: number | null }

/** An `Entry` as written to disk: `endedAt` is `null` while it runs, and `note` always present. */
type ExportedEntry = Omit<Entry, 'endedAt' | 'note' | 'deletedAt'> & {
  endedAt: number | null
  note: string | null
  deletedAt: number | null
}

/** A `Completion` needs no translation — it has no sentinel-encoded field. */
type ExportedCompletion = Completion

export type TransferFile = {
  formatVersion: number
  exportedAt: number
  activities: ExportedActivity[]
  entries: ExportedEntry[]
  completions: ExportedCompletion[]
}

const nullIfAbsent = (deletedAt: number) => (deletedAt === NOT_DELETED ? null : deletedAt)

/** The whole database, tombstones included, as the JSON text of a backup file. */
export async function exportJson(): Promise<string> {
  const [activities, entries, completions] = await Promise.all([
    db.activities.toArray(),
    db.entries.toArray(),
    db.completions.toArray(),
  ])

  const file: TransferFile = {
    formatVersion: FORMAT_VERSION,
    exportedAt: Date.now(),
    activities: activities.map((activity) => ({
      ...activity,
      deletedAt: nullIfAbsent(activity.deletedAt),
    })),
    entries: entries.map((entry) => ({
      ...entry,
      endedAt: entry.endedAt === OPEN_ENTRY_END ? null : entry.endedAt,
      note: entry.note ?? null,
      deletedAt: nullIfAbsent(entry.deletedAt),
    })),
    // Verbatim, `done: false` rows included. Those rows are the record that a day was
    // deliberately cleared, so dropping them on export would let a re-import resurrect it.
    completions,
  }

  return JSON.stringify(file, null, 2)
}

const CSV_COLUMNS = [
  'activity',
  'measure',
  'date',
  'started',
  'ended',
  'duration_minutes',
  'note',
] as const

/**
 * Live records as CSV, one row each, for a spreadsheet.
 *
 * Times are local and written `2026-07-31 09:00` rather than as an ISO instant: the owner
 * analyses their own day, and a UTC column silently shifts every late-evening entry into
 * tomorrow. A running entry has no end and no duration — inventing one would put a number in
 * the file that is wrong a second later.
 *
 * ponytail: one table for both measures, so a check-off row leaves the four interval columns
 * blank. A filter on `measure` separates them in one click, where two files would be two
 * buttons, two functions and two things to explain.
 */
export async function exportCsv(): Promise<string> {
  const [activities, entries, completions] = await Promise.all([
    db.activities.toArray(),
    db.entries.toArray(),
    db.completions.toArray(),
  ])
  const nameById = new Map(activities.map((activity) => [activity.id, activity.name]))
  const nameOf = (activityId: string) => nameById.get(activityId) ?? '(deleted activity)'

  const entryRows = entries.filter(isLive).map((entry) => {
    const running = entry.endedAt === OPEN_ENTRY_END
    return {
      at: entry.startedAt,
      cells: [
        nameOf(entry.activityId),
        'duration' satisfies Measure,
        localTimestamp(entry.startedAt).slice(0, 10),
        localTimestamp(entry.startedAt),
        running ? '' : localTimestamp(entry.endedAt),
        running ? '' : String(Math.round((entry.endedAt - entry.startedAt) / 60_000)),
        entry.note ?? '',
      ],
    }
  })

  const completionRows = completions
    .filter((row) => row.done)
    .map((row) => ({
      at: parseKey(row.day).getTime(),
      cells: [nameOf(row.activityId), 'count' satisfies Measure, row.day, '', '', '', ''],
    }))

  const rows = [...entryRows, ...completionRows]
    .sort((a, b) => a.at - b.at)
    .map((row) => row.cells.map(escapeCsv).join(','))

  return [CSV_COLUMNS.join(','), ...rows].join('\n')
}

const localTimestamp = (at: number) => toDateTimeInput(at).replace('T', ' ')

/** RFC 4180: quote a field that could otherwise break the row, doubling its own quotes. */
export function escapeCsv(field: string): string {
  if (!/[",\n\r]/.test(field)) return field
  return `"${field.replaceAll('"', '""')}"`
}

/**
 * Newer `updatedAt` wins, and a tie breaks on the greater `id` so that every device resolves
 * the same pair the same way without consulting any device-local state.
 *
 * Import is its first caller; sync would be its second.
 *
 * One wrinkle for completions: their ids are *derived* from the activity and the day, so a
 * tied pair has identical ids and the tiebreak degenerates to returning `remote`. That is a
 * no-op in practice — a tie means the same activity, the same day and the same millisecond —
 * and not worth a second rule.
 */
export function winner<T extends { id: string; updatedAt: number }>(local: T, remote: T): T {
  if (local.updatedAt !== remote.updatedAt) {
    return local.updatedAt > remote.updatedAt ? local : remote
  }
  return local.id > remote.id ? local : remote
}

export type ImportResult = { activities: number; entries: number; completions: number }

/**
 * Restore a backup file into the database.
 *
 * The whole file is validated before anything is written, and the write itself is one Dexie
 * transaction, so a malformed file leaves the database exactly as it was. Records that
 * already exist are resolved by `winner`, the same last-write-wins rule sync would use,
 * which is why the file's own `updatedAt` values are preserved rather than restamped.
 *
 * ponytail: the invariant check reads the entries table whole. At one owner's volume (~18k
 * entries/year) that is a few megabytes; if it ever matters, count open entries through the
 * `endedAt` index instead.
 */
export async function importJson(text: string): Promise<ImportResult> {
  const file = parseTransferFile(text)

  return db.transaction('rw', db.activities, db.entries, db.completions, async () => {
    const activities = await resolve(file.activities.map(toStoredActivity), db.activities)
    const entries = await resolve(file.entries.map(toStoredEntry), db.entries)
    const completions = await resolve(file.completions.map(toStoredCompletion), db.completions)

    const corrected = await resolveDuplicateOpenEntries(entries)

    // `corrected` is applied over `entries` rather than beside it: a record can appear in both,
    // and the closure has to be the version that lands.
    const toWrite = new Map(entries.map((entry) => [entry.id, entry]))
    for (const entry of corrected) toWrite.set(entry.id, entry)

    await db.activities.bulkPut(activities)
    await db.entries.bulkPut([...toWrite.values()])
    await db.completions.bulkPut(completions)
    return {
      activities: activities.length,
      entries: entries.length,
      completions: completions.length,
    }
  })
}

/** Each incoming record, or the record already stored if that one is the LWW winner. */
async function resolve<T extends { id: string; updatedAt: number }>(
  incoming: T[],
  table: { bulkGet(ids: string[]): Promise<(T | undefined)[]> },
): Promise<T[]> {
  const stored = await table.bulkGet(incoming.map((record) => record.id))
  return incoming.map((record, index) => {
    const local = stored[index]
    return local ? winner(local, record) : record
  })
}

/**
 * Entries are closed, never reopened, and exactly one may be open per activity. A merge can
 * arrive with two open for one activity — two devices each started the same timer while
 * offline — so this restores the invariant instead of refusing the batch.
 *
 * Refusing was the earlier behaviour, and it is the wrong one for sync: the rejected pair is
 * still there on the next attempt, so a single duplicated timer would wedge syncing forever.
 * The latest start stays open and each earlier one is closed where the next began, which keeps
 * the time they recorded rather than discarding it.
 *
 * Every correction restamps `updatedAt`, which is what makes the fix converge — it has to beat
 * the still-open copy on whichever device has not merged yet.
 *
 * Returns the corrected records to write alongside the incoming ones, because a loser can be a
 * record already stored here rather than one that just arrived.
 */
async function resolveDuplicateOpenEntries(incoming: Entry[]): Promise<Entry[]> {
  const stored = await db.entries.where('endedAt').equals(OPEN_ENTRY_END).toArray()
  const openAfterImport = new Map(stored.filter(isLive).map((entry) => [entry.id, entry]))

  // The incoming records are the ones that will be written, so each one replaces — or
  // removes, when it arrives closed or deleted — whatever was open under its id.
  for (const entry of incoming) {
    if (entry.endedAt === OPEN_ENTRY_END && isLive(entry)) openAfterImport.set(entry.id, entry)
    else openAfterImport.delete(entry.id)
  }

  const openByActivity = new Map<string, Entry[]>()
  for (const entry of openAfterImport.values()) {
    const open = openByActivity.get(entry.activityId) ?? []
    open.push(entry)
    openByActivity.set(entry.activityId, open)
  }

  const now = Date.now()
  const corrected: Entry[] = []
  for (const open of openByActivity.values()) {
    if (open.length < 2) continue

    const byStart = [...open].sort((a, b) => a.startedAt - b.startedAt)
    for (let index = 0; index < byStart.length - 1; index += 1) {
      const entry = byStart[index]
      const nextStart = byStart[index + 1].startedAt
      corrected.push(
        nextStart > entry.startedAt
          ? { ...entry, endedAt: nextStart, updatedAt: now }
          // Identical starts leave no interval to close, and an entry may not end when it
          // begins. Two timers started for one activity in the same millisecond are the same
          // timer, so the duplicate becomes a tombstone instead.
          : { ...entry, deletedAt: now, updatedAt: now },
      )
    }
  }
  return corrected
}

function toStoredActivity(activity: ExportedActivity): Activity {
  return { ...activity, deletedAt: activity.deletedAt ?? NOT_DELETED }
}

function toStoredEntry({ note, ...entry }: ExportedEntry): Entry {
  return {
    ...entry,
    endedAt: entry.endedAt ?? OPEN_ENTRY_END,
    deletedAt: entry.deletedAt ?? NOT_DELETED,
    // Absent rather than null: `null` is not a valid stored value anywhere in `data/`.
    ...(note === null ? {} : { note }),
  }
}

/**
 * The id is **recomputed** from the activity and the day rather than taken from the file.
 *
 * That deletes a whole class of malformed input with no validation branch — a mismatched id,
 * or two rows claiming the same activity-day under different ids — and it has to happen
 * before `resolve`, so that last-write-wins compares the pairs that actually collide.
 */
function toStoredCompletion(completion: ExportedCompletion): Completion {
  return { ...completion, id: completionId(completion.activityId, completion.day) }
}

/**
 * Validate the file before a single record is written. Every failure throws an `Error` whose
 * `message` is written for the owner, the same trust-boundary contract `saveActivity` and
 * `saveEntry` follow.
 */
export function parseTransferFile(text: string): TransferFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  const file = parsed as Partial<TransferFile>
  if (!isObject(parsed) || typeof file.formatVersion !== 'number') {
    throw new Error('That file is not an Activity Tracker export.')
  }
  if (file.formatVersion > FORMAT_VERSION) {
    throw new Error(
      `That file was exported by a newer version of the app (format ${file.formatVersion}). ` +
        'Update the app and import again.',
    )
  }
  if (file.formatVersion !== FORMAT_VERSION) {
    throw new Error(`Unknown export format ${file.formatVersion}.`)
  }
  if (!Array.isArray(file.activities) || !Array.isArray(file.entries)) {
    throw new Error('That export is missing its activities or entries.')
  }
  // Tolerated rather than required: an export with no check-offs at all is a valid file, and
  // a missing array is indistinguishable from an empty one to everything downstream.
  file.completions ??= []
  if (!Array.isArray(file.completions)) {
    throw new Error('That export’s check-offs are not a list.')
  }

  file.activities.forEach(validateActivity)
  file.entries.forEach(validateEntry)
  file.completions.forEach(validateCompletion)
  return file as TransferFile
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const PERIODS: Period[] = ['day', 'week', 'month']
const MEASURES: Measure[] = ['count', 'duration']
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function validateActivity(value: unknown, index: number): void {
  const reject = (why: string) => {
    throw new Error(`Activity ${index + 1} ${why}.`)
  }
  if (!isObject(value)) reject('is not a record')
  const activity = value as Record<string, unknown>

  if (!isNonEmptyString(activity.id)) reject('has no id')
  if (!isNonEmptyString(activity.name)) reject('has no name')
  if (!isNonEmptyString(activity.color)) reject('has no color')
  if (!MEASURES.includes(activity.measure as Measure)) reject('has no measure')
  if (typeof activity.archived !== 'boolean') reject('has no archived flag')
  if (!Number.isFinite(activity.sortOrder)) reject('has no sort order')
  if (activity.description !== undefined && typeof activity.description !== 'string') {
    reject('has an unreadable description')
  }
  if (activity.targetAmount !== undefined && !Number.isFinite(activity.targetAmount)) {
    reject('has an unreadable target')
  }
  if (activity.targetPeriod !== undefined && !PERIODS.includes(activity.targetPeriod as Period)) {
    reject('has an unknown target period')
  }
  validateTimestamps(activity, reject)
}

function validateEntry(value: unknown, index: number): void {
  const reject = (why: string) => {
    throw new Error(`Entry ${index + 1} ${why}.`)
  }
  if (!isObject(value)) reject('is not a record')
  const entry = value as Record<string, unknown>

  if (!isNonEmptyString(entry.id)) reject('has no id')
  if (!isNonEmptyString(entry.activityId)) reject('has no activity')
  if (!Number.isFinite(entry.startedAt)) reject('has no start time')
  if (entry.endedAt !== null && !Number.isFinite(entry.endedAt)) {
    reject('has an unreadable end time')
  }
  if (typeof entry.endedAt === 'number' && entry.endedAt <= (entry.startedAt as number)) {
    reject('ends before it starts')
  }
  if (entry.note !== null && entry.note !== undefined && typeof entry.note !== 'string') {
    reject('has an unreadable note')
  }
  validateTimestamps(entry, reject)
}

function validateCompletion(value: unknown, index: number): void {
  const reject = (why: string) => {
    throw new Error(`Check-off ${index + 1} ${why}.`)
  }
  if (!isObject(value)) reject('is not a record')
  const completion = value as Record<string, unknown>

  if (!isNonEmptyString(completion.activityId)) reject('has no activity')
  if (!isNonEmptyString(completion.day) || !DAY_PATTERN.test(completion.day as string)) {
    reject('has no day')
  }
  // Strictly a boolean, never coerced. `done ?? true` or `!!done` would turn a deliberately
  // cleared day back into a completed one — the easiest bug to introduce in this file.
  if (typeof completion.done !== 'boolean') reject('does not say whether it was done')
  if (!Number.isFinite(completion.updatedAt)) reject('has no updatedAt')
}

function validateTimestamps(record: Record<string, unknown>, reject: (why: string) => void): void {
  if (!Number.isFinite(record.createdAt)) reject('has no createdAt')
  if (!Number.isFinite(record.updatedAt)) reject('has no updatedAt')
  if (record.deletedAt !== null && !Number.isFinite(record.deletedAt)) {
    reject('has an unreadable deletedAt')
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0
