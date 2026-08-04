/**
 * The pull-to-refresh gesture's geometry: pure numbers, no React, so it lives here rather than in
 * the component and can be tested on its own. See `components/PullToRefresh.tsx` for the handler.
 */

/** Pull past this many pixels and release to trigger a refresh. */
export const THRESHOLD = 72
/** The indicator cannot be dragged further than this, however hard you pull. */
export const MAX_PULL = 110
/** Fraction of finger travel the indicator actually moves — the rubber-band resistance. */
export const RESISTANCE = 0.5

/** How far the indicator has travelled for a given finger drag: resisted, clamped, never negative. */
export function pullDistance(fingerDelta: number): number {
  if (fingerDelta <= 0) return 0
  return Math.min(MAX_PULL, fingerDelta * RESISTANCE)
}
