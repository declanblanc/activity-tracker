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
 */
export default function Trend({
  periods,
  scale,
  measure,
  title,
}: {
  periods: ScoredPeriod[]
  scale: Period
  /** Decides the unit on the axis and in the tooltip. */
  measure: Measure
  /** Names the series, in the caption and the tooltip. */
  title: string
}) {
  // Hours for a duration, so the axis reads in a human unit; a plain count of days otherwise.
  const scaleOf = (total: number) => (measure === 'duration' ? total / HOUR : total)
  const data = periods.map((period, index) => ({
    label: tickLabel(period.window, scale),
    full: periodLabel(period.window, scale),
    value: scaleOf(period.total),
    viewed: index === periods.length - 1,
  }))

  if (data.length === 0 || data.every((row) => row.value === 0)) {
    return (
      <p className="mt-6 text-center text-sm text-ink-muted">
        Nothing recorded in the last {data.length} {scale}s.
      </p>
    )
  }

  const mean = data.reduce((sum, row) => sum + row.value, 0) / data.length
  /** Back from the axis unit into the amount `formatAmount` expects. */
  const unscale = (value: number) => (measure === 'duration' ? value * HOUR : value)
  // A count average is usually fractional — four logged days over twelve weeks is 0.33 — and
  // `formatAmount` rounds to whole days, which would print "0 days" for it. One decimal place
  // is the smallest thing that stops the average reading as nothing.
  const meanLabel =
    measure === 'duration'
      ? formatAmount('duration', unscale(mean))
      : `${mean.toFixed(1)} ${mean === 1 ? 'day' : 'days'}`

  return (
    <div className="panel mt-4 p-4">
      <h2 className="flex items-baseline gap-2 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        {title} by {scale}
        <span className="font-normal tracking-normal normal-case tabular-nums">
          avg {meanLabel}
        </span>
      </h2>
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
              tickFormatter={(value: number) => (measure === 'duration' ? `${value}h` : `${value}`)}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-canvas)',
                border: '1px solid var(--color-line)',
                borderRadius: 8,
              }}
              labelStyle={{ color: 'var(--color-ink)' }}
              formatter={(value) => [formatAmount(measure, unscale(Number(value))), title]}
              labelFormatter={(_, payload) => payload?.[0]?.payload.full ?? ''}
            />
            {/* Twelve bars of similar height say nothing without something to be similar *to*.
                Already in the bundle, so it costs no bytes. */}
            <ReferenceLine y={mean} stroke="var(--color-ink-subtle)" strokeDasharray="3 3" />
            {/* Animation off: the bars grow from zero over 1.5s on every render, which on a
                screen whose period nav is two taps apart reads as lag, not as motion.
                `maxBarSize` so twelve bars across a wide panel stay bars rather than spreading
                into a solid block. */}
            <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false}>
              {data.map((row) => (
                <Cell
                  key={row.full}
                  fill={row.viewed ? 'var(--color-accent)' : 'var(--color-raised)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
