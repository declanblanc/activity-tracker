import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

/** Past this much leftward travel, releasing deletes. Capped so wide cards stay reachable. */
const commitDistance = (cardWidth: number) => Math.min(cardWidth * 0.4, 140)

/** Enough movement to call it a swipe rather than a tap. */
const TAP_SLOP = 6

/**
 * Swipe a card left to delete it, in about forty lines of pointer events and one CSS
 * transform. A gesture library would be several hundred kilobytes for this.
 *
 * Extracted rather than duplicated: both kinds of activity card use it, and every comment
 * below documents a bug that was already hit once.
 *
 * The swiping surface is `children`, so the caller keeps ownership of its own padding and
 * background — this only supplies the clipping wrapper, the revealed underlay, and the drag.
 */
export default function SwipeToDelete({
  onDelete,
  className = '',
  children,
}: {
  onDelete: () => void
  /** Applied to the swiping surface, which is the card itself. */
  className?: string
  children: ReactNode
}) {
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  /**
   * The gesture is tracked in refs rather than state on purpose. `pointermove` can arrive in
   * the same tick as `pointerdown`, before React has re-rendered, so a handler reading
   * `dragging` from its closure would drop the opening moves of the swipe.
   */
  const startX = useRef<number | null>(null)
  /** Survives past `pointerup` so the click the browser then fires can be swallowed. */
  const swiped = useRef(false)

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    swiped.current = false
    if (event.pointerType === 'mouse' && event.button !== 0) return

    startX.current = event.clientX
    setDragging(true)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (startX.current === null) return
    // Leftward only — a rightward drag has nothing to reveal.
    const offset = Math.min(0, event.clientX - startX.current)
    if (Math.abs(offset) > TAP_SLOP) swiped.current = true
    setDragX(offset)
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLElement>) {
    const start = startX.current
    if (start === null) return
    startX.current = null
    setDragging(false)

    // Measured from the event rather than from `dragX`, for the same reason.
    const offset = Math.min(0, event.clientX - start)
    const width = event.currentTarget.getBoundingClientRect().width
    if (-offset > commitDistance(width)) onDelete()
    // Springs back either way: on delete the card unmounts, and if the toast is undone it
    // should reappear at rest rather than mid-swipe.
    setDragX(0)
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 flex items-center bg-danger pr-5 pl-8 text-sm font-semibold text-slate-950"
      >
        Delete
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        // A mouse that leaves the card mid-swipe never delivers its `pointerup` here, so the
        // gesture resolves at the boundary instead. `setPointerCapture` would be the usual
        // answer, but a captured pointer also owns the click the browser fires afterwards:
        // every tap meant for the buttons inside would land on the card and do nothing.
        // Touch pointers are captured by the browser anyway, so this costs the phone nothing
        // — it is only the mouse that can walk out of a gesture.
        onPointerLeave={onPointerEnd}
        // A swipe ends in a click the browser still dispatches; without this, releasing over
        // a control inside the card would also press it.
        onClickCapture={(event) => {
          if (!swiped.current) return
          event.preventDefault()
          event.stopPropagation()
          swiped.current = false
        }}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? 'none' : 'transform 150ms ease-out',
        }}
        // `pan-y` keeps vertical page scrolling with the browser while horizontal is ours.
        // Nothing inside a card may pan horizontally, or the two gestures fight — which is
        // why the card's strip sizes itself to fit rather than scrolling.
        className={`relative touch-pan-y ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
