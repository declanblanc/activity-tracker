import { db } from './db.ts'
import {
  NOT_DELETED,
  OPEN_ENTRY_END,
  isLive,
  isOpen,
  newId,
  type Entry,
  type EntryInput,
} from './types.ts'

/**
 * Every live entry that is still running.
 *
 * This is the app's hottest read — the dashboard's "which timers are running" state —
 * and it works only because open-ness is the `OPEN_ENTRY_END` sentinel rather
 * than `null`, which is not a valid IndexedDB key.
 */
export async function getOpenEntries(): Promise<Entry[]> {
  const open = await db.entries.where('endedAt').equals(OPEN_ENTRY_END).toArray()
  return open.filter(isLive)
}

/**
 * Every live entry whose interval *intersects* `[rangeStart, rangeEnd)` — formally
 * `endedAt > rangeStart AND startedAt < rangeEnd`.
 *
 * The key range is on `endedAt`, not `startedAt`. "Entries that started inside the
 * window" would silently drop an interval that began before the window and ended
 * inside it — a sleep entry running 23:00→07:00 would be invisible to a query for
 * today. Anchoring on `endedAt` also sweeps in open entries for free, since
 * `OPEN_ENTRY_END` is above every real timestamp.
 *
 * Whole stored records are returned; clipping them to the window is the accounting
 * layer's job.
 *
 * ponytail: the `endedAt` key range walks forward from `rangeStart`, so a window far
 * in the past scans every entry recorded since. At one owner's volume (~18k
 * entries/year) that is milliseconds. If Insights over old months ever measures slow,
 * add a compound `[deletedAt+endedAt]` index and range on it — no API change.
 */
export async function getEntriesInRange(rangeStart: number, rangeEnd: number): Promise<Entry[]> {
  const candidates = await db.entries.where('endedAt').above(rangeStart).toArray()
  return candidates
    .filter((entry) => entry.startedAt < rangeEnd && entry.deletedAt === NOT_DELETED)
    .sort((a, b) => a.startedAt - b.startedAt)
}

/**
 * Every live entry of one activity whose interval intersects `[rangeStart, rangeEnd)`.
 *
 * Same window rule as `getEntriesInRange` — anchored on `endedAt`, so an interval that
 * began before the window is still found — narrowed to one activity through the
 * compound `[activityId+endedAt]` index.
 */
export async function getEntriesForActivity(
  activityId: string,
  rangeStart: number,
  rangeEnd: number,
): Promise<Entry[]> {
  const candidates = await db.entries
    .where('[activityId+endedAt]')
    .between([activityId, rangeStart], [activityId, OPEN_ENTRY_END], false, true)
    .toArray()
  return candidates
    .filter((entry) => entry.startedAt < rangeEnd && isLive(entry))
    .sort((a, b) => a.startedAt - b.startedAt)
}

/** One entry by id, or undefined if it does not exist or has been soft-deleted. */
export async function getEntry(id: string): Promise<Entry | undefined> {
  const entry = await db.entries.get(id)
  return entry && isLive(entry) ? entry : undefined
}

/**
 * Open an entry for the activity, starting at `at`.
 *
 * Nothing here truncates or shifts any other activity's entry: overlapping timers
 * are the point of the app, so opening one is simply an insert.
 *
 * Nothing here checks that the activity is a `duration` one either. That would need a read
 * of `db.activities` inside this transaction, and the only route to a timer on a check-off
 * activity is a hand-edited import file. The result is invisible rather than wrong —
 * `dayAmounts` reads completions for a count activity and ignores its entries.
 *
 * The one-open-entry-per-activity invariant is enforced by *reusing* an existing open
 * entry rather than by rejecting the call — a double tap, a second tab, and an import
 * all reach this path, and none of them wants an error. The read and the insert share
 * one transaction so two concurrent calls cannot both see "no open entry" and both
 * insert.
 */
export async function startActivity(activityId: string, at: number = Date.now()): Promise<Entry> {
  return db.transaction('rw', db.entries, async () => {
    const [existing] = await openEntriesFor(activityId)
    if (existing) return existing

    const now = Date.now()
    const entry: Entry = {
      id: newId(),
      activityId,
      startedAt: at,
      endedAt: OPEN_ENTRY_END,
      createdAt: now,
      updatedAt: now,
      deletedAt: NOT_DELETED,
    }
    await db.entries.add(entry)
    return entry
  })
}

/**
 * Shortest stretch worth keeping. Under this, closing a timer is taken to be a mis-tap —
 * a stop immediately followed by a start, or a start nobody meant — rather than something
 * that happened.
 *
 * The floor is on this path only. `saveEntry` has no such rule: times typed into a form
 * are deliberate, and a hand-corrected twenty-second entry is a record, not a slip.
 */
export const MIN_TRACKED_MS = 30_000

/**
 * Close the activity's open entry, if it has one. A no-op otherwise.
 *
 * A stretch shorter than `MIN_TRACKED_MS` is closed and then discarded, and the result
 * says so, because the one thing worse than dropping a mis-tap is dropping it silently.
 *
 * Discarding is a soft delete like every other: a physical row removal is the one edit a
 * future sync could never carry to another device. The cost is a tombstone per mis-tap,
 * which is invisible everywhere — every read filters on `deletedAt` — and small.
 *
 * The invariant allows at most one open entry per activity, but this closes every
 * one it finds rather than trusting that: leaving a stray open entry running would
 * inflate every later total, and closing an extra costs nothing.
 */
export async function stopActivity(
  activityId: string,
  at: number = Date.now(),
): Promise<{ discarded: boolean }> {
  const open = await openEntriesFor(activityId)
  const now = Date.now()

  const discarded = await Promise.all(
    open.map(async (entry) => {
      // An inverted stretch counts as too short, which is the right side to fail on: a
      // negative interval is never something to keep.
      const tooShort = at - entry.startedAt < MIN_TRACKED_MS
      const changes: Partial<Entry> = { endedAt: at, updatedAt: now }
      if (tooShort) changes.deletedAt = now
      await db.entries.update(entry.id, changes)
      return tooShort
    }),
  )

  return { discarded: discarded.some(Boolean) }
}

/**
 * Insert or update one entry — a hand-corrected interval, a note, or a manual record
 * of time that was never toggled.
 *
 * Validation lives here rather than in the form because this is the trust boundary
 * that import and sync will also write through, and an inverted or zero-length
 * interval quietly corrupts every total computed over it. The messages are written
 * for the user: the form renders whatever this throws.
 *
 * The whole record is `put`, not patched, so clearing a note actually removes it.
 *
 * The saved interval is then folded together with any same-activity interval it
 * overlaps, so the returned entry is not always the one that was passed in.
 */
export async function saveEntry(input: EntryInput): Promise<Entry> {
  return db.transaction('rw', db.entries, async () => {
    const existing = input.id ? await getEntry(input.id) : undefined
    if (input.id && !existing) throw new Error('That entry no longer exists.')

    const problem = invalid(input, existing)
    if (problem) throw new Error(problem)

    const now = Date.now()
    const note = input.note?.trim()
    const saved: Entry = {
      id: existing?.id ?? newId(),
      activityId: input.activityId,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? OPEN_ENTRY_END,
      ...(note ? { note } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: NOT_DELETED,
    }
    await db.entries.put(saved)
    return mergeSameActivityOverlaps(saved)
  })
}

/**
 * Fold every live interval of the same activity that *strictly* overlaps `saved` into
 * one record, soft-deleting the absorbed ones, and return the survivor.
 *
 * Only genuine overlap merges: 09:00–12:00 and 12:00–14:00 merely touch and stay two
 * records — they already sum correctly, so merging them would buy no accuracy while
 * discarding a boundary the owner drew and one of the two notes. (The wall-clock union
 * in the accounting layer *does* join touching intervals. The two rules look alike and
 * answer different questions.)
 *
 * Normal toggling cannot produce a same-activity overlap; hand edits and reassignment
 * can, and left alone they would double-count the shared minutes in that activity's
 * total.
 */
async function mergeSameActivityOverlaps(saved: Entry): Promise<Entry> {
  let span = { startedAt: saved.startedAt, endedAt: saved.endedAt }
  const absorbed = new Map<string, Entry>()

  // Each absorption widens the span, which can pull in a record that did not overlap
  // the original interval: 10:00–11:00 absorbs 09:00–10:30, and the resulting
  // 09:00–11:00 now overlaps 08:00–09:30. So this repeats until a pass finds nothing
  // new rather than reading the neighbours once.
  for (;;) {
    const overlapping = (
      await getEntriesForActivity(saved.activityId, span.startedAt, span.endedAt)
    ).filter((other) => other.id !== saved.id && !absorbed.has(other.id))
    if (overlapping.length === 0) break

    for (const other of overlapping) {
      absorbed.set(other.id, other)
      span = {
        startedAt: Math.min(span.startedAt, other.startedAt),
        endedAt: Math.max(span.endedAt, other.endedAt),
      }
    }
  }

  if (absorbed.size === 0) return saved

  const group = [saved, ...absorbed.values()]
  // The open entry keeps the id when the group contains one: the activity is still
  // running, and stopping a live timer — or reopening a closed record — is worse than
  // the edited record losing its id and its note to the survivor.
  const open = group.find(isOpen)
  const now = Date.now()
  const survivor: Entry = {
    ...(open ?? saved),
    startedAt: span.startedAt,
    // Open-ness is decided by the record, not by `max()` over a sentinel that merely
    // happens to sort above every real timestamp.
    endedAt: open ? OPEN_ENTRY_END : span.endedAt,
    updatedAt: now,
  }

  await db.entries.put(survivor)
  await Promise.all(
    group
      .filter((entry) => entry.id !== survivor.id)
      .map((entry) => db.entries.update(entry.id, { deletedAt: now, updatedAt: now })),
  )
  return survivor
}

/**
 * Move an entry to another activity, leaving its interval and note alone.
 *
 * This goes back through `saveEntry` rather than patching `activityId`, because
 * reassignment is the other way a same-activity overlap appears: the entry may land on
 * top of an interval the destination activity already has, and that has to merge.
 *
 * Nothing here rejects an archived destination — correcting old data is exactly why
 * a recorded entry can be edited at all.
 */
export async function reassignEntry(id: string, activityId: string): Promise<Entry> {
  return db.transaction('rw', db.entries, async () => {
    const existing = await getEntry(id)
    if (!existing) throw new Error('That entry no longer exists.')

    return saveEntry({
      id: existing.id,
      activityId,
      startedAt: existing.startedAt,
      endedAt: existing.endedAt,
      note: existing.note,
    })
  })
}

/**
 * Tombstone an entry: it leaves every read, and the record stays so that a future sync
 * can propagate the delete rather than letting another device resurrect it.
 */
export async function softDeleteEntry(id: string): Promise<void> {
  const now = Date.now()
  await db.entries.update(id, { deletedAt: now, updatedAt: now })
}

/** The user-facing reason `input` cannot be stored, or null when it can. */
function invalid(input: EntryInput, existing?: Entry): string | null {
  if (!input.activityId) return 'Choose an activity.'
  if (!Number.isFinite(input.startedAt)) return 'Enter a start time.'

  // `null` is how a screen asks for "still running"; the sentinel is what a caller
  // inside `src/data/` already holds. Both mean open, and neither may reopen a closed
  // entry — which is also what stops the sentinel being stored as a real end time.
  if (input.endedAt === null || input.endedAt === OPEN_ENTRY_END) {
    return existing && isOpen(existing) ? null : 'Enter an end time.'
  }

  if (!Number.isFinite(input.endedAt)) return 'Enter an end time.'
  if (input.endedAt === input.startedAt) return 'An entry cannot be zero minutes long.'
  if (input.endedAt < input.startedAt) return 'The end time must be after the start time.'
  return null
}

/** The activity's live open entries — at most one, by the invariant above. */
async function openEntriesFor(activityId: string): Promise<Entry[]> {
  const open = await db.entries
    .where('[activityId+endedAt]')
    .equals([activityId, OPEN_ENTRY_END])
    .toArray()
  return open.filter(isLive)
}
