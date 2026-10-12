/**
 * One muted line under the Activities title saying when this device last synced.
 *
 * `SyncAgent` polls every few seconds and an unchanged server counts as a success, so while sync
 * works a duration would always read "just now". The line gives the clock time instead, which
 * moves visibly, and switches to how long ago only once sync has stopped: offline, a wrong token,
 * the endpoint down. That is the moment what is on screen may be behind the other device.
 *
 * Staleness counts from whichever is later, the last success or the app becoming visible. Sync only
 * runs while visible, so after a night in a pocket `lastSyncAt` is hours old for the second it takes
 * the first pass to land; measuring from it alone would read "8h ago" on every launch.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { usePref } from '../data/prefs.ts'
import { formatDuration, formatTime } from '../lib/format.ts'
import { toDateTimeInput } from '../lib/time.ts'
import { useNow } from '../lib/useNow.ts'

/** How long sync may keep failing before the line says so: a dozen attempts at the agent's pace. */
const GRACE_MS = 60_000

const DAY_MS = 24 * 60 * 60 * 1000

export default function SyncStatus() {
  const token = usePref('syncToken')
  const lastSyncAt = usePref('lastSyncAt')
  const now = useNow(5_000)
  const [visibleSince, setVisibleSince] = useState(Date.now)

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) setVisibleSince(Date.now())
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return (
    <Link to="/settings" className="focus-ring block rounded text-xs text-ink-muted">
      {message(token, lastSyncAt, visibleSince, now)}
    </Link>
  )
}

function message(token: string, lastSyncAt: number, visibleSince: number, now: number): string {
  if (!token) return 'Sync off'
  const age = now - lastSyncAt
  if (age < GRACE_MS) return `Synced ${formatTime(lastSyncAt)}`
  // Just opened or just returned to: the first pass is still in flight, not failing.
  if (now - visibleSince < GRACE_MS) return 'Syncing…'
  if (lastSyncAt === 0) return 'Not synced yet'
  if (age < DAY_MS) return `Last synced ${formatDuration(age)} ago`
  return `Last synced ${toDateTimeInput(lastSyncAt).replace('T', ' ')}`
}
