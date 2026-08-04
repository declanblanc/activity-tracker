/**
 * Pull down from the top of the scroll area to sync.
 *
 * A local-first app has nothing to fetch on a normal navigation — every screen already reads a
 * live query — so "refresh" here means "sync now", the one thing a pull can usefully do. When no
 * sync token is set the gesture is a harmless no-op that springs back.
 *
 * Custom rather than a library: an installed PWA has no browser pull-to-refresh of its own, and
 * there is no DOM event for the gesture, so the whole of it is this one file of touch handling.
 * `overscroll-y-contain` on the scroll container (see `App.tsx`) stops the browser's native
 * pull-to-refresh from firing a second, page-reloading refresh on top of this one.
 */
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { pullDistance, THRESHOLD } from '../lib/pullToRefresh.ts'

export default function PullToRefresh({
  scrollRef,
  onRefresh,
  children,
}: {
  scrollRef: RefObject<HTMLElement | null>
  onRefresh: () => Promise<void>
  children: ReactNode
}) {
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  // No transition while the finger is down — the indicator must track it exactly; a transition
  // only on release is what makes the spring-back smooth instead of a snap.
  const [dragging, setDragging] = useState(false)

  // Gesture state lives in refs so the once-bound touch handlers never read a stale render's copy.
  const startY = useRef<number | null>(null)
  const distanceRef = useRef(0)
  const refreshingRef = useRef(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const settle = () => {
      startY.current = null
      distanceRef.current = 0
      setDistance(0)
      setDragging(false)
    }

    const onStart = (event: TouchEvent) => {
      // A pull only begins at the very top, and never while a refresh is already running.
      if (el.scrollTop <= 0 && !refreshingRef.current) startY.current = event.touches[0].clientY
    }

    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return
      const delta = event.touches[0].clientY - startY.current
      if (delta <= 0) {
        // The finger is at or above where it started: this is an ordinary scroll, not a pull.
        settle()
        return
      }
      // Hold the content still rather than let it rubber-band, so the indicator is the only thing
      // that moves. Needs a non-passive listener, registered below.
      event.preventDefault()
      const pulled = pullDistance(delta)
      distanceRef.current = pulled
      setDistance(pulled)
      setDragging(true)
    }

    const onEnd = () => {
      if (startY.current === null) return
      const triggered = distanceRef.current >= THRESHOLD
      startY.current = null
      setDragging(false)
      if (!triggered) {
        distanceRef.current = 0
        setDistance(0)
        return
      }
      // Hold the indicator at the threshold while the sync runs, then spring it back when done.
      refreshingRef.current = true
      setRefreshing(true)
      setDistance(THRESHOLD)
      void onRefresh().finally(() => {
        refreshingRef.current = false
        setRefreshing(false)
        distanceRef.current = 0
        setDistance(0)
      })
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [scrollRef, onRefresh])

  const progress = Math.min(1, distance / THRESHOLD)

  return (
    <>
      {(distance > 0 || refreshing) && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center ${
            dragging ? '' : 'transition-transform duration-200'
          }`}
          style={{ transform: `translateY(${distance}px)` }}
        >
          {/* Starts tucked just above the top edge and rides down with the pull. */}
          <div className="panel -mt-11 flex size-9 items-center justify-center rounded-full shadow-lg shadow-black/30">
            <RefreshCw
              className={`size-5 text-ink-muted ${refreshing ? 'animate-spin' : ''}`}
              style={
                refreshing
                  ? undefined
                  : { transform: `rotate(${progress * 270}deg)`, opacity: 0.3 + progress * 0.7 }
              }
              aria-hidden
            />
          </div>
        </div>
      )}
      {children}
    </>
  )
}
