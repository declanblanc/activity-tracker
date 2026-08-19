import { db } from './db.ts'
import { completionId, type Completion, type DateKey } from './types.ts'

/**
 * Check-offs: one row per `count` activity per local day.
 *
 * The counterpart to `entries.ts`, and much the simpler of the two — a check-off has no
 * duration to validate, no overlap to fold, and no open state. What it does have is a
 * tombstone that is a *value*: see `Completion` in `types.ts` for why `done: false` is
 * stored rather than the row being removed.
 */

/**
 * Every check-off ever recorded, including the `done: false` ones.
 *
 * The whole table, deliberately: this is what keeps a count activity's total and its streak
 * all-time rather than bounded by whatever horizon the screen happens to be reading. Only
 * the entries read is bounded, because intervals are the high-volume record.
 *
 * ponytail: at ~50 bytes a row, eight counted activities over five years is ~15k rows and a
 * few hundred KB — less than the single localStorage string the predecessor app held the
 * same data in. Ceiling: it is an O(n) read on every dashboard open. If it ever measures
 * slow, range on the `day` index for the horizon actually being drawn and accept a bounded
 * total, or keep a per-activity running count.
 */
export async function getCompletions(): Promise<Completion[]> {
  return db.completions.toArray()
}

/** Every check-off in `[fromDay, toDay]`, both ends inclusive. */
export async function getCompletionsInRange(
  fromDay: DateKey,
  toDay: DateKey,
): Promise<Completion[]> {
  // Keys are zero-padded, so the lexical range the index walks is the chronological one.
  return db.completions.where('day').between(fromDay, toDay, true, true).toArray()
}

/**
 * Set one day's check-off to `done`.
 *
 * There is deliberately no `toggle` counterpart reading the stored row first. A day the timer
 * ran on reads as checked off with no row at all (see `completionAmounts`), so "the opposite of
 * what is stored" and "the opposite of what the owner is looking at" stopped being the same
 * answer — and only the second one is the gesture. Every caller has the day's drawn state to
 * hand, so it passes what it wants rather than asking storage to work it out.
 *
 * The derived primary key means there can only ever be one row per activity-day whatever races.
 */
export async function setCompletion(
  activityId: string,
  day: DateKey,
  done: boolean,
): Promise<void> {
  await write(activityId, day, done)
}

/**
 * `put`, not `add` or `update`: the derived id makes this an upsert, which is what both
 * callers want and what makes a replayed import idempotent.
 *
 * Writes `done: false` rather than deleting the row. The row is the record that a decision
 * was made, and only its `done` says which way — deleting it would make "I cleared this
 * day" indistinguishable from "I never touched this day", so a stale copy of the day
 * arriving from an import would resurrect it.
 */
async function write(activityId: string, day: DateKey, done: boolean): Promise<void> {
  await db.completions.put({
    id: completionId(activityId, day),
    activityId,
    day,
    done,
    updatedAt: Date.now(),
  })
}
