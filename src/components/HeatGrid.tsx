import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { DateKey } from '../data/types.ts'
import { GAP, SQUARE, weekGrid } from '../lib/heatStrip.ts'
import { formatKey } from '../lib/time.ts'

/** How much credit a day has earned, which is all a square needs to shade itself. */
type DayCredit = 'none' | 'partial' | 'full'

type Props = {
  /** The activity's own colour, for the filled squares. */
  color: string
  /** day → 1 for a logged day, from `dayAmounts`. */
  amounts: Map<DateKey, number>
  today: DateKey
  /** Columns of history to render. The detail sheet uses 53; a card renders what fits. */
  weeks: number
  /**
   * Days per week the activity is aiming for, when it is scored by the week. A week that reaches
   * it shades whole. Absent for an every-day activity, which is what preserves the rule that such
   * an activity never shades a column: seven days out of seven is just seven completed days.
   */
  weeklyTarget?: number
  /**
   * What activating a day does. Absent makes the squares non-interactive, which is what an
   * archived activity gets: it renders its history and accepts no new marks.
   */
  onDayActivate?: (day: DateKey) => void
}

/**
 * Seven rows of days, one column per week, oldest on the left — a contribution graph.
 *
 * **Check-off activities only.** The grid answers "did this happen, on which days", which is the
 * whole question for something you tick and the wrong question for something you measure in
 * hours: a timed activity's day is a quantity, and a square that is on or off either throws that
 * quantity away or invents a threshold for it. Timed activities get a list of their stretches in
 * their own sheet, the Today timeline and the Insights trend, all of which can show magnitude.
 *
 * That is why this takes a colour and a target rather than an `Activity` — there is no `measure`
 * here to branch on, and no way to pass something that has one.
 *
 * The strip scrolls horizontally and is pinned to its right edge on mount, so a caller asking for
 * more weeks than it has room for still opens on today. That is the detail sheet's bargain — a
 * full year in a narrow drawer. A dashboard card instead sizes its request to the space it has,
 * and so never scrolls.
 */
export function HeatGrid({ color, amounts, today, weeks, weeklyTarget, onDayActivate }: Props) {
  const cells = useMemo(() => weekGrid(today, weeks), [today, weeks])
  const scroller = useRef<HTMLDivElement>(null)

  /**
   * Whether each column's week reached its goal, scored once per column rather than once per
   * square.
   *
   * Summed straight from the column's own seven cells, which is exact because `weekGrid` starts
   * its columns on the same `WEEK_STARTS_ON` that `weekWindow` does — so a shaded column and the
   * week the goals panel scores are the same seven days by construction.
   */
  const metWeeks = useMemo(() => {
    if (weeklyTarget === undefined) return []
    return Array.from({ length: weeks }, (_, column) => {
      let total = 0
      for (let row = 0; row < 7; row++) {
        const day = cells[column * 7 + row]
        // A `null` cell is a day still to come, and contributes nothing.
        if (day !== null) total += amounts.get(day) ?? 0
      }
      return total >= weeklyTarget
    })
  }, [amounts, cells, weeks, weeklyTarget])

  useEffect(() => {
    const element = scroller.current
    if (!element) return

    // Today lives in the last column, so the useful end of the strip is the right one.
    const pinToToday = () => {
      element.scrollLeft = element.scrollWidth
    }
    pinToToday()

    // Re-pin on resize. A strip that was too wide to scroll when it mounted becomes scrollable
    // when the window narrows or the phone rotates, and would otherwise be left sitting at the
    // oldest weeks with today off-screen.
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
    // Set here rather than inherited from the card, so the grid is self-contained: an invisible
    // dependency on an ancestor's custom property is worse than repeating it.
    '--activity': color,
  } as CSSProperties

  return (
    <div ref={scroller} className="overflow-x-auto overscroll-x-contain py-0.5">
      <div style={gridStyle}>
        {cells.map((day, index) => {
          if (day === null) {
            // Keeps the final column's rows aligned to their weekdays without offering a future
            // day to click.
            return <div key={`empty-${index}`} aria-hidden="true" />
          }

          const done = (amounts.get(day) ?? 0) > 0
          const weekMet = metWeeks[Math.floor(index / 7)] ?? false
          // `partial` is a week that hit its goal, on a day that was not itself logged: the day
          // was never the unit being scored, so a plain miss would misreport a good week.
          const credit: DayCredit = done ? 'full' : weekMet ? 'partial' : 'none'
          const shared = {
            className: 'heat-square',
            'data-credit': credit,
            'data-today': day === today,
            title: formatKey(day),
          }
          const label = squareLabel(day, done, weekMet)

          if (!onDayActivate) return <div key={day} {...shared} aria-label={label} />

          return (
            <button
              key={day}
              type="button"
              {...shared}
              aria-label={label}
              aria-pressed={done}
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
function squareLabel(day: DateKey, done: boolean, weekMet: boolean): string {
  const date = formatKey(day)
  if (done) return `${date} — completed`
  return weekMet ? `${date} — not completed, weekly goal met` : `${date} — not completed`
}
