import { saveActivity, softDeleteActivity } from './activities.ts'
import { setCompletion } from './completions.ts'
import { deleteAllData } from './db.ts'
import { saveEntry } from './entries.ts'
import type { Activity, ActivityInput } from './types.ts'
import { dateKey } from '../lib/time.ts'

/**
 * A believable database to develop against, so trying a change does not start with twenty
 * minutes of tapping activities in.
 *
 * Written through the same `data/*` functions the app uses rather than straight into Dexie:
 * ids, sentinels, `updatedAt` stamps and the same-activity overlap fold all come out right
 * because nothing here knows they exist. It costs a few hundred small writes, which on a local
 * IndexedDB is a second at most.
 *
 * **Generated relative to `now`, not stored as a fixture.** A checked-in JSON blob would drift:
 * its newest day slides out of the year the dashboard draws, streaks die, and the seed reads as
 * "an app I stopped using in March". Every date below is an offset from today, so the data is
 * always current — and deterministic, because `random` is seeded, so two runs give the same
 * history and a screenshot means the same thing tomorrow.
 *
 * ponytail: dev-only, and imported dynamically by the Settings screen so it is not in the
 * production bundle. Ceiling: the shapes are hand-written rather than drawn from anything real.
 * If a screen ever needs data this does not exercise, add an activity here rather than
 * hand-entering it once.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A year, which is what the dashboard reads and the sheet's grid draws. */
const HISTORY_DAYS = 365

export type SeedCounts = {
  activities: number
  entries: number
  completions: number
}

/**
 * Wipe the database and write the sample one in its place.
 *
 * Wipes rather than merges: a seed on top of real data leaves a mixture that is neither, and
 * the caller has already confirmed. `deleteAllData` also forgets the merged sync version, so a
 * device with a sync token pulls the server's copy back on the next poll — which is the correct
 * outcome, since seeded data has no business being uploaded as if it were the owner's.
 */
export async function seedSampleData(now: number = Date.now()): Promise<SeedCounts> {
  await deleteAllData()

  const random = seededRandom(20260818)
  const counts: SeedCounts = { activities: 0, entries: 0, completions: 0 }

  /** Midnight local, `daysAgo` days back — the anchor every entry below is offset from. */
  const midnight = (daysAgo: number) => {
    const date = new Date(now - daysAgo * DAY)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  const add = async (input: ActivityInput): Promise<Activity> => {
    counts.activities += 1
    return saveActivity(input)
  }

  /** One stretch, given as minutes-past-midnight so a day's shape reads at a glance. */
  const track = async (activity: Activity, daysAgo: number, startMinute: number, minutes: number) => {
    // Nothing in the future: today's later blocks would otherwise be tracked hours that have
    // not happened, which is exactly what the accounting window clamps away anyway.
    const startedAt = midnight(daysAgo) + startMinute * MINUTE
    const endedAt = startedAt + minutes * MINUTE
    if (endedAt > now) return
    await saveEntry({ activityId: activity.id, startedAt, endedAt })
    counts.entries += 1
  }

  const check = async (activity: Activity, daysAgo: number, done = true) => {
    await setCompletion(activity.id, dateKey(midnight(daysAgo)), done)
    counts.completions += 1
  }

  // A plain habit with a long, live streak: the card that has a number worth looking at, and
  // the one activity whose history is check-offs and nothing else.
  const meditate = await add({
    name: 'Meditate',
    description: 'Ten minutes, first thing.',
    color: '#a78bfa',
    icon: '🧘',
    measure: 'count',
    display: 'habit',
    targetAmount: 1,
    targetPeriod: 'day',
  })
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo++) {
    // An unbroken recent run, then a habit that mostly holds and sometimes does not — a grid of
    // one solid block reads as fake, and a streak of two reads as nothing.
    const kept = daysAgo < 9 || random() < 0.72
    if (kept) await check(meditate, daysAgo)
    // A cleared day here and there, so the `done: false` tombstone is represented too.
    else if (random() < 0.15) await check(meditate, daysAgo, false)
  }

  // The timer the week's hours are about: a weekly target, several blocks a weekday, and the
  // one activity heavy enough for the Insights trend to have a shape.
  const deepWork = await add({
    name: 'Deep work',
    description: 'Uninterrupted, no meetings.',
    color: '#38bdf8',
    icon: '🧠',
    measure: 'duration',
    display: 'timer',
    targetAmount: 12 * HOUR,
    targetPeriod: 'week',
  })
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo++) {
    const weekday = new Date(midnight(daysAgo)).getDay()
    if (weekday === 0 || weekday === 6) continue
    if (random() < 0.2) continue
    await track(deepWork, daysAgo, 9 * 60 + Math.floor(random() * 45), 60 + Math.floor(random() * 75))
    if (random() < 0.75) {
      await track(deepWork, daysAgo, 13 * 60 + Math.floor(random() * 60), 45 + Math.floor(random() * 90))
    }
  }

  // The hybrid the tracked-time credit is about: scored on the check-off and drawn as a habit,
  // but most of its done days are done because the timer ran, not because anything was tapped.
  const run = await add({
    name: 'Run',
    description: 'Anything over a mile counts.',
    color: '#f472b6',
    icon: '🏃',
    measure: 'count',
    display: 'habit',
    targetAmount: 4,
    targetPeriod: 'week',
  })
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo++) {
    if (random() > 0.55) continue
    await track(run, daysAgo, 7 * 60 + Math.floor(random() * 30), 25 + Math.floor(random() * 40))
    // Only occasionally also tapped: the square is filled by the time either way, which is the
    // behaviour worth having in front of you while working on it.
    if (random() < 0.2) await check(run, daysAgo)
  }

  // Card and goal decoupled on purpose: a timer card whose goal is scored on the check-off.
  const reading = await add({
    name: 'Reading',
    description: 'Paper, not a screen.',
    color: '#fbbf24',
    icon: '📖',
    measure: 'count',
    display: 'timer',
    targetAmount: 1,
    targetPeriod: 'day',
  })
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo++) {
    if (random() > 0.6) continue
    await track(reading, daysAgo, 21 * 60 + Math.floor(random() * 60), 20 + Math.floor(random() * 50))
  }

  // Entries that cross midnight, which is the one shape that catches a window read anchored on
  // `startedAt` instead of `endedAt`.
  const sleep = await add({
    name: 'Sleep',
    color: '#818cf8',
    icon: '🌙',
    measure: 'duration',
    display: 'timer',
    targetAmount: 49 * HOUR,
    targetPeriod: 'week',
  })
  for (let daysAgo = 1; daysAgo < 120; daysAgo++) {
    // Starts the previous evening and ends the next morning, so each night lands in two days.
    await track(sleep, daysAgo + 1, 23 * 60 + Math.floor(random() * 40), 6 * 60 + Math.floor(random() * 120))
  }

  // A monthly target, so the goals panel has one of each period.
  const walk = await add({
    name: 'Long walk',
    color: '#34d399',
    icon: '🥾',
    measure: 'count',
    display: 'habit',
    targetAmount: 12,
    targetPeriod: 'month',
  })
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo++) {
    if (random() < 0.4) await check(walk, daysAgo)
  }

  // Archived: history intact, off the dashboard until "Show archived".
  const guitar = await add({
    name: 'Guitar',
    description: 'Put down in the spring.',
    color: '#fb923c',
    icon: '🎸',
    measure: 'duration',
    display: 'timer',
    archived: true,
  })
  for (let daysAgo = 120; daysAgo < 300; daysAgo++) {
    if (random() < 0.45) await track(guitar, daysAgo, 18 * 60, 20 + Math.floor(random() * 40))
  }

  // Soft-deleted, for the Deleted activities screen and its restore.
  const spanish = await add({
    name: 'Spanish',
    color: '#f87171',
    icon: '🗣️',
    measure: 'count',
    display: 'habit',
    targetAmount: 1,
    targetPeriod: 'day',
  })
  for (let daysAgo = 200; daysAgo < 260; daysAgo++) {
    if (random() < 0.6) await check(spanish, daysAgo)
  }
  await softDeleteActivity(spanish.id)

  return counts
}

/**
 * mulberry32: a small, fast PRNG with a fixed seed, so the sample database is the same one
 * every time it is written. `Math.random` would make a screenshot from yesterday
 * incomparable with the same screen today, which is most of what this data is for.
 */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state)
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296
  }
}
