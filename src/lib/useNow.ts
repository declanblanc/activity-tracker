import { useEffect, useState } from 'react'

/**
 * The current epoch ms, re-rendering every `every` ms.
 *
 * Elapsed time is always derived as `now - startedAt`, never accumulated, so nothing
 * here has to catch up after the app is backgrounded — the next tick reads the real
 * clock and is correct. The `visibilitychange` listener only removes the wait for that
 * tick, since browsers throttle timers in hidden tabs.
 *
 * (The purity rule that bans React from `lib/` is about `lib/accounting/`; this hook is
 * shared by the Tracker and the Today timeline and belongs to neither.)
 */
export function useNow(every = 1000): number {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, every)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [every])

  return now
}
