import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Measure, Period } from '../../data/types.ts'
import type { ScoredPeriod } from '../../lib/accounting/goals.ts'
import { formatAmount, periodLabel, tickLabel } from '../../lib/format.ts'

const HOUR = 60 * 60 * 1000

/**
 * One number per period, with the viewed period picked out.
 *
 * Fed `ScoredPeriod[]` rather than `PeriodTotals[]`, which is what lets it chart either measure:
 * a check-off activity's bars are days per period and a timed one's are hours, and only the axis
 * and the tooltip need to know which.
 *
 * **A period still running is drawn as two pieces**: what it holds, solid, and what it reaches at
 * its current rate, outlined above. Before that it was one short bar with no mark on it, sitting
 * under a mean line that included the short bar in its own average — so a normal Tuesday looked
 * like a collapse and the line it was judged against had already moved to meet it. The mean now
 * comes from closed periods only, and the caption says how many.
 */
export default function Trend({
  periods,
  scale,
  measure,
  title,
  projected,
  now,
}: {
  periods: ScoredPeriod[]
  scale: Period
  /** Decides the unit on the axis and in the tooltip. */
  measure: Measure
  /** Names the series, in the caption and the tooltip. */
  title: string
  /**
   * Where the last period lands if the rest of it goes like the days that closed. Absent when
   * the period has closed, or when no day of it has closed yet and there is nothing to project
   * from.
   */
  projected?: number | null
  now: number
}) {
  // Hours for a duration, so the axis reads in a human unit; a plain count of days otherwise.
  const scaleOf = (total: number) => (measure === 'duration' ? total / HOUR : total)
  const last = periods.length - 1
  const data = periods.map((period, index) => {
    const inProgress = period.window.end > now
    const value = scaleOf(period.total)
    return {
      label: tickLabel(period.window, scale),
      full: periodLabel(period.window, scale),
      value,
      // Stacked on top of `value`, so the pair reaches the projection. Only ever the last bar.
      toCome:
        index === last && inProgress && projected != null
          ? Math.max(0, scaleOf(projected) - value)
          : 0,
      viewed: index === last,
      inProgress,
    }
  })

  const closed = data.filter((row) => !row.inProgress)
  const empty = data.length === 0 || data.every((row) => row.value === 0)

  // A mean of nothing is not a baseline. With no closed period there is simply no line.
  const mean =
    closed.length > 0 ? closed.reduce((sum, row) => sum + row.value, 0) / closed.length : null
  /** Back from the axis unit into the amount `formatAmount` expects. */
  const unscale = (value: number) => (measure === 'duration' ? value * HOUR : value)
  // A count average is usually fractional — four logged days over twelve weeks is 0.33 — and
  // `formatAmount` rounds to whole days, which would print "0 days" for it. One decimal place
  // is the smallest thing that stops the average reading as nothing.
  const meanLabel =
    mean === null
      ? null
      : measure === 'duration'
        ? formatAmount('duration', unscale(mean))
        : `${mean.toFixed(1)} ${mean === 1 ? 'day' : 'days'}`

  return (
    <div className="panel mt-4 p-4">
      <h2 className="flex items-baseline gap-2 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        {title} by {scale}
        {meanLabel && (
          <span className="font-normal tracking-normal normal-case tabular-nums">
            avg {meanLabel}
          </span>
        )}
      </h2>

      {empty ? (
        <p className="mt-6 mb-4 text-center text-sm text-ink-muted">
          Nothing recorded in the last {data.length} {scale}s.
        </p>
      ) : (
        <>
          {/* The chart fills a box the layout sizes, rather than carrying a fixed pixel height of
              its own: given twice the width it would otherwise draw twelve bars as twelve stretched
              slabs. Taller on desktop keeps the aspect ratio sane. */}
          <div className="mt-2 h-40 w-full md:h-56">
            {/* Fed one pre-aggregated row per period, never raw entries. */}
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                {/* Recharts passes these straight through to SVG attributes, which resolve `var()`
                    like any other CSS — so the chart reads the same tokens the rest of the screen
                    does instead of carrying eight hardcoded hexes. */}
                <XAxis
                  dataKey="label"
                  interval="preserveStartEnd"
                  tick={{ fill: 'var(--color-ink-muted)', fontSize: 11 }}
                  stroke="var(--color-line)"
                />
                <YAxis
                  width={32}
                  allowDecimals={false}
                  tick={{ fill: 'var(--color-ink-muted)', fontSize: 11 }}
                  stroke="var(--color-line)"
                  tickFormatter={(value: number) =>
                    measure === 'duration' ? `${value}h` : `${value}`
                  }
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-line-subtle)' }}
                  contentStyle={{
                    background: 'var(--color-canvas)',
                    border: '1px solid var(--color-line)',
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: 'var(--color-ink)' }}
                  formatter={(value, name) => [
                    formatAmount(measure, unscale(Number(value))),
                    name === 'toCome' ? 'still to come, at this rate' : title,
                  ]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload.full ?? ''}
                />
                {/* Twelve bars of similar height say nothing without something to be similar *to*.
                    Already in the bundle, so it costs no bytes. */}
                {mean !== null && (
                  <ReferenceLine y={mean} stroke="var(--color-ink-subtle)" strokeDasharray="3 3" />
                )}
                {/* Animation off: the bars grow from zero over 1.5s on every render, which on a
                    screen whose period nav is two taps apart reads as lag, not as motion.
                    `maxBarSize` so twelve bars across a wide panel stay bars rather than spreading
                    into a solid block. */}
                <Bar
                  dataKey="value"
                  stackId="period"
                  maxBarSize={48}
                  isAnimationActive={false}
                >
                  {data.map((row) => (
                    <Cell
                      key={row.full}
                      fill={row.viewed ? 'var(--color-accent)' : 'var(--color-raised)'}
                    />
                  ))}
                </Bar>
                {/* The rest of the period, outlined rather than filled: it has not happened, and a
                    solid bar would claim it had. */}
                <Bar
                  dataKey="toCome"
                  stackId="period"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={48}
                  isAnimationActive={false}
                  fill="var(--color-accent)"
                  fillOpacity={0.18}
                  stroke="var(--color-accent-ink)"
                  strokeDasharray="3 3"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="mt-2 text-xs text-ink-muted">
            {meanLabel
              ? `Dashed line is the average of ${closed.length} closed ${scale}${closed.length === 1 ? '' : 's'}.`
              : `No closed ${scale} to average yet.`}
            {data[last]?.toCome > 0 && ' The outline is where this one lands at its current rate.'}
          </p>
        </>
      )}
    </div>
  )
}
