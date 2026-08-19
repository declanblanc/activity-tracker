import type { Activity, Period } from '../../data/types.ts'
import { percentileRank } from '../../lib/accounting/distribution.ts'
import type { PersonalBests } from '../../lib/bests.ts'
import { formatAmount } from '../../lib/format.ts'

/**
 * Where this period sits among the ones before it, and the record book behind them.
 *
 * "4h 30m this week" was the whole of what the focused view said, with no answer to the only
 * question a reader actually has about it: *is that good, for me?* Nothing on Insights ever
 * placed a number against its own history — no best, no all-time total, no rank.
 *
 * The bests are read over the activity's entire history, deliberately outside the bounded
 * window the rest of the screen shares: "longest ever" over twelve weeks is just "longest", a
 * different claim. See `bests.ts`.
 */
export default function Standing({
  activity,
  bests,
  rank,
  scale,
}: {
  activity: Activity
  bests: PersonalBests
  /**
   * The viewed period against the ones behind it, each cut to the same span — so a Tuesday is
   * placed among eleven other Tuesdays rather than among eleven finished weeks. `null` when
   * there is nothing closed to rank against.
   */
  rank: { value: number; series: number[]; partial: boolean } | null
  scale: Period
}) {
  const bestPeriod = activity.targetPeriod ?? 'day'
  const beaten =
    rank && rank.series.length > 0
      ? Math.round(percentileRank(rank.series, rank.value) * rank.series.length)
      : null

  return (
    <div className="panel mt-4">
      <h2 className="px-4 pt-4 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Standing
      </h2>
      <dl className="mt-1 flex flex-col">
        {/* A best day of one is what every check-off activity has, by construction: its day
            amounts are 1 or 0. The row is dropped rather than printed as "Best day: 1 day",
            and the test is on the amount rather than on the measure, because an activity that
            has never recorded a whole day of anything has nothing to boast of either. */}
        {!(bestPeriod === 'day' && bests.bestPeriod <= 1) && (
          <Row label={`Best ${bestPeriod}`} value={formatAmount(activity.measure, bests.bestPeriod)} />
        )}
        {bests.longestStreak !== undefined && (
          <Row
            label="Longest streak"
            value={`${bests.longestStreak} ${bestPeriod}${bests.longestStreak === 1 ? '' : 's'}`}
          />
        )}
        <Row label="All time" value={formatAmount(activity.measure, bests.lifetimeTotal)} />
        {beaten !== null && rank && (
          <Row
            label={rank.partial ? `This ${scale} so far` : `This ${scale}`}
            value={`ahead of ${beaten} of ${rank.series.length}`}
            note={
              rank.partial
                ? `Against the same days of the ${rank.series.length} ${scale}s behind it.`
                : `Against the ${rank.series.length} closed ${scale}${rank.series.length === 1 ? '' : 's'} behind it.`
            }
          />
        )}
      </dl>
    </div>
  )
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-t border-line-subtle px-4 py-2.5 first:border-t-0">
      <div className="flex items-baseline gap-2">
        <dt className="min-w-0 flex-1 truncate text-sm text-ink-soft">{label}</dt>
        <dd className="text-sm font-medium text-ink tabular-nums">{value}</dd>
      </div>
      {note && <p className="mt-0.5 text-xs text-ink-muted">{note}</p>}
    </div>
  )
}
