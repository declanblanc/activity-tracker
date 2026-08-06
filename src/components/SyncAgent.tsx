/**
 * Runs sync in the background: on mount, whenever the app becomes visible, a few seconds after any
 * local change, and on a short interval while the app stays visible.
 *
 * The interval and the change signal are the two directions. The interval is how this device hears
 * what the *other* one did, so it sets how long a change takes to appear here — seconds, not the
 * minute it used to be, which is affordable because `sync.ts` answers an unchanged server with one
 * small conditional request. The change signal is how what happens *here* leaves at once instead of
 * waiting out the interval; between the two, a stopped timer shows up on the other device in about
 * one interval rather than two.
 *
 * Still an interval and a database signal rather than a hook on every mutation, so no call site has
 * to remember to trigger one — and becoming visible is still the moment that matters most, which is
 * picking the phone back up.
 *
 * Failures are silent by design. This is an offline-first app, a failed sync is the normal state
 * on a train, and there is nothing for the owner to do about it. Settings shows the last success,
 * which is where a sync that has quietly stopped working becomes visible.
 *
 * Mounted in `App.tsx` rather than on Settings: sync that only runs while you look at it is not
 * sync.
 */
import { useEffect } from 'react'
import { onLocalChange } from '../data/db.ts'
import { getPref } from '../data/prefs.ts'
import { syncNow } from '../data/sync.ts'

/** How long a change made on another device can go unnoticed here. */
const INTERVAL_MS = 5_000

/**
 * How long to let local writes settle before uploading them.
 *
 * One action is several writes — stopping a timer closes an entry and a merge can correct another —
 * and each would otherwise be its own upload of the whole database.
 */
const SETTLE_MS = 300

export default function SyncAgent() {
  useEffect(() => {
    // One at a time. Two overlapping passes merge from the same blob version, so the second's
    // upload is refused as stale and its work is thrown away. A change that lands mid-pass sets
    // `again` rather than being dropped, because the running pass may already have read the
    // database by then.
    let running = false
    let again = false

    async function sync(): Promise<void> {
      if (document.hidden || !getPref('syncToken')) return
      if (running) {
        again = true
        return
      }

      running = true
      try {
        await syncNow()
      } catch {
        // Silent: see the note above.
      } finally {
        running = false
      }

      if (again) {
        again = false
        await sync()
      }
    }

    let settling: ReturnType<typeof setTimeout> | undefined
    const syncWhenSettled = () => {
      clearTimeout(settling)
      settling = setTimeout(() => void sync(), SETTLE_MS)
    }

    const onVisibilityChange = () => void sync()

    void sync()
    const interval = setInterval(() => void sync(), INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const stopWatchingDatabase = onLocalChange(syncWhenSettled)

    return () => {
      clearInterval(interval)
      clearTimeout(settling)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopWatchingDatabase()
    }
  }, [])

  return null
}
