import { db } from './db.ts'
import { stopActivity } from './entries.ts'
import {
  NOT_DELETED,
  displayMode,
  newId,
  type Activity,
  type ActivityInput,
  type Period,
} from './types.ts'

/**
 * Activity CRUD. Like every module here it stamps `updatedAt` on each write and
 * soft-deletes rather than removing rows, so nothing outside `src/data/` has to remember
 * either rule.
 *
 * `archived` and `measure` are not indexes (booleans and low-cardinality strings both make
 * poor ones, and a boolean is not even a valid IndexedDB key), so both are filtered in
 * memory over the handful of rows the `sortOrder` index returns.
 */

/**
 * The largest target a `count` activity can hold at each period.
 *
 * A count target is a number of *days*, so "nine days a week" can never be met and is not
 * a goal. A duration target has no equivalent ceiling — 25 hours a day is unreachable too,
 * but the tracked total is a real measurement rather than a count of days, and clamping it
 * would mean deciding what a plausible day looks like.
 *
 * ponytail: `month: 31` lets "31 days in February" through, which reads as a miss every
 * February. Fixing that needs the specific month, which a validator does not have — the
 * upgrade path is scoring the target against the month's real length at read time.
 */
const MAX_COUNT_TARGET: Record<Period, number> = { day: 1, week: 7, month: 31 }

/** Live activities in display order. Archived ones are excluded unless asked for. */
export async function getActivities(includeArchived = false): Promise<Activity[]> {
  const ordered = await db.activities.orderBy('sortOrder').toArray()
  return ordered.filter(
    (activity) => activity.deletedAt === NOT_DELETED && (includeArchived || !activity.archived),
  )
}

export async function getActivity(id: string): Promise<Activity | undefined> {
  const activity = await db.activities.get(id)
  return activity?.deletedAt === NOT_DELETED ? activity : undefined
}

/**
 * Insert or update an activity, depending on whether `input` carries an id.
 *
 * Validation lives here rather than in the form because this is the trust boundary: import
 * and, later, sync write through the same path.
 */
export async function saveActivity(input: ActivityInput): Promise<Activity> {
  const name = input.name.trim()
  if (name === '') throw new Error('An activity needs a name.')

  const existing = input.id ? await getActivity(input.id) : undefined

  // The goal axis: which axis the single goal, the streak and the "total" are scored on.
  // Changeable — it shapes no stored record — and independent of what the card shows. The form
  // clears the goal when it moves across measures, since a days target cannot be read as hours.
  const measure = input.measure

  // Which card the activity list draws. Display only: the sheet shows both axes for every
  // activity, and the goal above is decoupled from this. One choice, so there is nothing to
  // validate — an update that says nothing keeps what is stored, and an insert that says nothing
  // takes the measure's card.
  const display = input.display ?? existing?.display ?? displayMode({ measure })

  if (input.targetAmount !== undefined) {
    // Negated rather than `<= 0` so a NaN from a half-typed form field is rejected too.
    if (!(input.targetAmount > 0)) throw new Error('A target must be greater than zero.')

    if (measure === 'count') {
      if (!Number.isInteger(input.targetAmount)) {
        throw new Error('A check-off target is a whole number of days.')
      }
      const ceiling = MAX_COUNT_TARGET[input.targetPeriod ?? 'day']
      if (input.targetAmount > ceiling) {
        throw new Error(`A target of more than ${ceiling} day(s) per ${input.targetPeriod ?? 'day'} can never be met.`)
      }
    }
  }

  const now = Date.now()
  const definition = {
    name,
    description: input.description?.trim() || undefined,
    color: input.color,
    icon: input.icon?.trim() || undefined,
    measure,
    display,
    targetAmount: input.targetAmount,
    targetPeriod: input.targetPeriod,
    archived: input.archived ?? false,
    updatedAt: now,
  }

  const saved: Activity = existing
    ? { ...existing, ...definition }
    : {
        ...definition,
        id: input.id ?? newId(),
        sortOrder: await nextSortOrder(),
        createdAt: now,
        deletedAt: NOT_DELETED,
      }

  await db.activities.put(saved)
  // An activity that leaves the dashboard must not keep accruing time behind it. A count
  // activity has no timer to stop, and `stopActivity` is a no-op for one.
  if (saved.archived && !existing?.archived) await stopActivity(saved.id, now)
  return saved
}

/**
 * Tombstone the activity. Its entries and check-offs are left alone — the history is the
 * point, and restoring the activity restores it intact.
 */
export async function softDeleteActivity(id: string): Promise<void> {
  const now = Date.now()
  await stopActivity(id, now)
  await db.activities.update(id, { deletedAt: now, updatedAt: now })
}

/** Deleted activities, most-recently-deleted first, for the restore page. */
export async function getDeletedActivities(): Promise<Activity[]> {
  const all = await db.activities.toArray()
  return all
    .filter((activity) => activity.deletedAt !== NOT_DELETED)
    .sort((a, b) => b.deletedAt - a.deletedAt)
}

/**
 * Lift the tombstone off an activity. Its entries and check-offs were never touched, so it
 * comes back with its history intact. The fresh `updatedAt` makes the restore win on the next
 * sync, the same way the delete that stamped it did.
 */
export async function restoreActivity(id: string): Promise<void> {
  await db.activities.update(id, { deletedAt: NOT_DELETED, updatedAt: Date.now() })
}

/** Rewrite `sortOrder` to match the given order. Ids not listed are left where they are. */
export async function reorderActivities(orderedIds: string[]): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.activities, async () => {
    await Promise.all(
      orderedIds.map((id, index) => db.activities.update(id, { sortOrder: index, updatedAt: now })),
    )
  })
}

/**
 * ponytail: sortOrder is a plain append counter, and reordering renumbers the whole list.
 * With ~10 activities that is one transaction of ~10 updates. Fractional ordering keys only
 * earn their complexity at list sizes this app will never see.
 */
async function nextSortOrder(): Promise<number> {
  const last = await db.activities.orderBy('sortOrder').last()
  return last ? last.sortOrder + 1 : 0
}
