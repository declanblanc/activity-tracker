import { useEffect, useState } from 'react'
import { parseKey, shiftKey, todayKey } from './time.ts'

/**
 * Sampling `todayKey()` once per mount would go stale in an installed PWA left open
 * across midnight — and just after midnight is exactly when this app gets used, so a
 * stale value silently logs to the wrong day.
 *
 * Two triggers, because neither alone is enough: the timer handles a window that stays
 * visible across midnight, and the visibility/focus listener handles a device that was
 * asleep when the timer should have fired.
 */
export function useToday() {
  const [today, setToday] = useState(todayKey)

  useEffect(() => {
    const resample = () => setToday(todayKey())

    // `parseKey` gives local midnight, so this stays correct across DST shifts. The extra
    // second keeps a slightly early fire from re-reading the same day.
    const msUntilTomorrow = parseKey(shiftKey(today, 1)).getTime() - Date.now() + 1000
    const timer = setTimeout(resample, msUntilTomorrow)

    document.addEventListener('visibilitychange', resample)
    window.addEventListener('focus', resample)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', resample)
      window.removeEventListener('focus', resample)
    }
  }, [today])

  return today
}
