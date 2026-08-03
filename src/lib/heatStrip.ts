import type { DateKey } from '../data/types.ts'
import { shiftKey, weekdayOf } from './time.ts'

/**
 * Geometry of the heat strip, shared by the grid that draws it and the card that sizes
 * itself to it.
 */
export const SQUARE = 13
export const GAP = 3

/**
 * Whole week columns that fit in `width` pixels of strip. The last column carries no
 * trailing gap, which is the `+ GAP`. Callers that would rather size themselves to the
 * grid than scroll it use this to pick their week count.
 */
export const weeksThatFit = (width: number) =>
  Math.max(1, Math.floor((width + GAP) / (SQUARE + GAP)))

/**
 * `weeks * 7` keys in column-major order — index `column * 7 + row` — so a CSS grid with
 * `grid-auto-flow: column` and 7 rows lays them out directly.
 *
 * Columns are weeks starting on `WEEK_STARTS_ON`, the same constant `weekWindow` uses, which
 * is what keeps a shaded column and the week that scores it the same seven days. Every row
 * is therefore one weekday, as on the GitHub contribution graph.
 *
 * `endKey` sits in the final column; the days after it in that column come back `null` so
 * the caller can render them as blank placeholders rather than clickable future days.
 */
export function weekGrid(endKey: DateKey, weeks: number): (DateKey | null)[] {
  const lastColumnStart = shiftKey(endKey, -weekdayOf(endKey))
  const firstColumnStart = shiftKey(lastColumnStart, -(weeks - 1) * 7)

  const cells: (DateKey | null)[] = []
  for (let column = 0; column < weeks; column++) {
    for (let row = 0; row < 7; row++) {
      const key = shiftKey(firstColumnStart, column * 7 + row)
      // Keys are zero-padded, so lexical order is chronological order.
      cells.push(key > endKey ? null : key)
    }
  }
  return cells
}
