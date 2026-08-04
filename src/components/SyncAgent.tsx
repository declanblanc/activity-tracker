/**
 * Runs sync in the background: on mount, whenever the app becomes visible, and once a minute
 * while it stays visible.
 *
 * An interval rather than a hook on every mutation, so no call site has to remember to trigger
 * one — and becoming visible is the moment that matters most, which is picking the phone back up.
 *
 * Failures are silent by design. This is an offline-first app, a failed sync is the normal state
 * on a train, and there is nothing for the owner to do about it. Settings shows the last success,
 * which is where a sync that has quietly stopped working becomes visible.
 *
 * Mounted in `App.tsx` rather than on Settings: sync that only runs while you look at it is not
 * sync.
 */
import { useEffect } from 'react'
import { getPref } from '../data/prefs.ts'
import { syncNow } from '../data/sync.ts'

const INTERVAL_MS = 60_000

export default function SyncAgent() {
  useEffect(() => {
    // One at a time. A slow round trip must not have the interval stack a second sync on top of
    // it, because both would upload a merge computed from the same starting point and the later
    // upload would drop whatever the earlier one had just added.
    let running = false

    async function sync() {
      if (running || document.hidden || !getPref('syncToken')) return

      running = true
      try {
        await syncNow()
      } catch {
        // Silent: see the note above.
      } finally {
        running = false
      }
    }

    const onVisibilityChange = () => void sync()

    void sync()
    const interval = setInterval(() => void sync(), INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return null
}
