import type { Activity } from '../../data/types.ts'
import Meter from '../ui/Meter.tsx'

export type DoneRow = {
  activity: Activity
  /** Days of the period this activity was checked off on. */
  done: number
}

/**
 * Days checked off in the viewed period, the counterpart to "where the time went".
 *
 * Three of the four panels here were gated on there being *any* tracked time, so someone
 * keeping five habits and no timers saw the goals list and nothing else — the whole aggregate
 * view was about hours. This is the other axis, in the same shape: one row per activity,
 * sorted, against the same denominator.
 *
 * Every activity is eligible, whatever measure scores it: a day the timer ran is a day the
 * thing was done, and this reads the same credit the heat grid and the streak do. A timed
 * activity showing 7 of 7 is not noise — it is the run that a single blank day breaks.
 */
export default function WhatGotDone({ rows, daysElapsed }: { rows: DoneRow[]; daysElapsed: number }) {
  const shown = rows.filter((row) => row.done > 0).sort((a, b) => b.done - a.done)
  // A single day can only ever be 1 of 1, so every row would be a full bar — and a full bar
  // means "goal met" everywhere else in the app. One day's check-offs are what Today is for.
  if (shown.length === 0 || daysElapsed <= 1) return null

  return (
    <div className="panel mt-4">
      <h2 className="px-4 pt-4 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        What got done
      </h2>
      <ul className="mt-1 flex flex-col">
        {shown.map((row) => (
          <li
            key={row.activity.id}
            className="border-t border-line-subtle px-4 py-3 first:border-t-0"
          >
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {row.activity.name}
              </span>
              <span className="text-sm text-ink-soft tabular-nums">
                {row.done} / {daysElapsed} {daysElapsed === 1 ? 'day' : 'days'}
              </span>
            </div>
            {/* Against the days that have happened, not the days the period holds: a Tuesday
                showing 2 of 7 would be reporting the calendar rather than the habit. */}
            <Meter fraction={row.done / daysElapsed} color={row.activity.color} />
          </li>
        ))}
      </ul>
    </div>
  )
}
