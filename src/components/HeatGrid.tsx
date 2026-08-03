import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { Activity, DateKey } from '../data/types.ts'
import { targetAt } from '../lib/accounting/goals.ts'
import { dayCredit } from '../lib/days.ts'
import { formatAmount } from '../lib/format.ts'
import { GAP, SQUARE, weekGrid } from '../lib/heatStrip.ts'
import { formatKey } from '../lib/time.ts'

type Props = {
  activity: Activity
  /** day → amount, from `dayAmounts`. Both measures arrive in this one shape. */
  amounts: Map<DateKey, number>
  today: DateKey
  /** Columns of history to render. The detail sheet uses 53; a card renders what fits. */
  weeks: number
  /**
   * What activating a day does. Absent makes the squares non-interactive, which is what an
   * archived activity gets: it renders its history and accepts no new marks.
   */
  onDayActivate?: (day: DateKey) => void
}

/**
 * Seven rows of days, one column per week, oldest on the left.
 *
 * Measure-agnostic: it is handed amounts and asks `dayCredit` how to shade them, so a habit's
 * check-offs and a timer's hours draw through exactly the same path.
 *
 * The strip scrolls horizontally and is pinned to its right edge on mount, so a caller asking
 * for more weeks than it has room for still opens on today. That is the detail sheet's bargain
 * — a full year in a narrow drawer. A dashboard card instead sizes its request to the space it
 * has, and so never scrolls.
 */
export function HeatGrid({ activity, amounts, today, weeks, onDayActivate }: Props) {
  const cells = useMemo(() => weekGrid(today, weeks), [today, weeks])
  const scroller = useRef<HTMLDivElement>(null)

  /**
   * Whether each column's week reached a weekly goal, scored once per column rather than once
   * per square.
   *
   * Summed straight from the column's own seven cells, which is exact because `weekGrid` starts
   * its columns on the same `WEEK_STARTS_ON` that `weekWindow` does — so a shaded column and
   * the week the goals panel scores are the same seven days by construction.
   *
   * Empty when there is no weekly goal, which preserves the rule that an activity scored by the
   * day never shades a whole column: seven days out of seven is just seven completed days.
   */
  const metWeeks = useMemo(() => {
    const target = targetAt(activity, 'week')
    if (target === null) return []
    return Array.from({ length: weeks }, (_, column) => {
      let total = 0
      for (let row = 0; row < 7; row++) {
        const day = cells[column * 7 + row]
        // A `null` cell is a day still to come, and contributes nothing.
        if (day !== null) total += amounts.get(day) ?? 0
      }
      return total >= target
    })
  }, [activity, amounts, cells, weeks])

  useEffect(() => {
    const element = scroller.current
    if (!element) return

    // Today lives in the last column, so the useful end of the strip is the right one.
    const pinToToday = () => {
      element.scrollLeft = element.scrollWidth
    }
    pinToToday()

    // Re-pin on resize. A strip that was too wide to scroll when it mounted becomes
    // scrollable when the window narrows or the phone rotates, and would otherwise be left
    // sitting at the oldest weeks with today off-screen.
    const observer = new ResizeObserver(pinToToday)
    observer.observe(element)
    return () => observer.disconnect()
  }, [weeks])

  const gridStyle = {
    display: 'grid',
    gridAutoFlow: 'column',
    gridTemplateRows: `repeat(7, ${SQUARE}px)`,
    gridAutoColumns: `${SQUARE}px`,
    gap: `${GAP}px`,
    // Set here rather than inherited from the card, so the grid is self-contained: an
    // invisible dependency on an ancestor's custom property is worse than repeating it. A
    // running card happens to set the same value, which is a harmless no-op.
    '--activity': activity.color,
  } as CSSProperties

  return (
    <div ref={scroller} className="overflow-x-auto overscroll-x-contain py-0.5">
      <div style={gridStyle}>
        {cells.map((day, index) => {
          if (day === null) {
            // Keeps the final column's rows aligned to their weekdays without offering a
            // future day to click.
            return <div key={`empty-${index}`} aria-hidden="true" />
          }

          const amount = amounts.get(day) ?? 0
          const weekMet = metWeeks[Math.floor(index / 7)] ?? false
          const credit = dayCredit(activity, amount, weekMet)
          const shared = {
            className: 'heat-square',
            'data-credit': credit,
            'data-today': day === today,
            title: formatKey(day),
          }

          if (!onDayActivate) {
            return (
              <div key={day} {...shared} aria-label={squareLabel(activity, day, amount, weekMet)} />
            )
          }

          return (
            <button
              key={day}
              type="button"
              {...shared}
              aria-label={squareLabel(activity, day, amount, weekMet)}
              // A check-off is a toggle and says so. A timed day opens a form to edit that
              // day's entries, which is not a pressed state — so it gets no `aria-pressed`.
              aria-pressed={activity.measure === 'count' ? credit === 'full' : undefined}
              onClick={() => onDayActivate(day)}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * What one square says to a screen reader.
 *
 * The "weekly goal met" clause is not decoration: the shading says it to a sighted reader, and
 * without it a met week reads as four plain misses.
 */
function squareLabel(
  activity: Activity,
  day: DateKey,
  amount: number,
  weekMet: boolean,
): string {
  const date = formatKey(day)

  if (activity.measure === 'count') {
    if (amount > 0) return `${date} — completed`
    return weekMet ? `${date} — not completed, weekly goal met` : `${date} — not completed`
  }

  if (amount > 0) return `${date} — ${formatAmount('duration', amount)} tracked`
  return weekMet ? `${date} — nothing tracked, weekly goal met` : `${date} — nothing tracked`
}
