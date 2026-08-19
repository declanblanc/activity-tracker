import type { Measure } from '../../data/types.ts'
import { formatAmount } from '../../lib/format.ts'
import { describeRhythm, type WeekdayAmount } from '../../lib/rhythm.ts'

/** Sunday first, matching the profile's own order and the heat grid's rows. */
const INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Seven columns: how a typical week actually goes.
 *
 * Scaled against the busiest weekday rather than against a goal, because this is a shape and
 * not a verdict — the question is which days carry the week, not whether any of them passed.
 * That is also why the bars are one flat colour: a status colour here would assert a direction
 * the app only knows inside a target.
 */
export default function Rhythm({
  profile,
  measure,
  color,
  caption,
}: {
  profile: WeekdayAmount[]
  measure: Measure
  /** The activity's own colour when focused; the accent across all of them. */
  color?: string
  /** What span the averages cover, e.g. "last 15 weeks". */
  caption: string
}) {
  const peak = profile.reduce((high, slot) => Math.max(high, slot.mean), 0)
  if (peak <= 0) return null

  const note = describeRhythm(profile, measure)
  const fill = color ?? 'var(--color-accent)'

  return (
    <div className="panel mt-4 p-4">
      <h2 className="flex items-baseline gap-2 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Rhythm
        <span className="ml-auto font-normal tracking-normal normal-case">{caption}</span>
      </h2>

      {/* A description list: each weekday is a term and its average is the definition, so a
          screen reader gets the numbers the bars encode rather than seven unlabelled boxes. */}
      <dl className="mt-3 grid grid-cols-7 gap-1.5">
        {profile.map((slot) => (
          <div key={slot.weekday} className="flex flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end">
              <div
                className="w-full rounded-t-sm"
                style={{
                  // A weekday with nothing on it still shows a sliver, so the column reads as
                  // measured-and-empty rather than as missing.
                  height: `${Math.max(2, (slot.mean / peak) * 100)}%`,
                  backgroundColor: fill,
                  opacity: 0.85,
                }}
              />
            </div>
            {/* The named weekday is marked on its label rather than on its bar: the day worth
                naming is as often the shortest column as the tallest, and a brightened sliver
                reads as the opposite of the sentence under it. */}
            <dt
              className={
                note?.weekday === slot.weekday
                  ? 'text-2xs font-semibold text-ink'
                  : 'text-2xs text-ink-muted'
              }
            >
              <abbr title={NAMES[slot.weekday]} className="no-underline">
                {INITIALS[slot.weekday]}
              </abbr>
            </dt>
            <dd className="sr-only">{formatAmount(measure, slot.mean)} on average</dd>
          </div>
        ))}
      </dl>

      {/* A level week is a finding too, and saying so is what stops seven identical bars
          reading as a panel that failed to load. `describeRhythm` stays silent rather than
          inventing a standout; the absence is what this sentence reports. */}
      <p className="mt-3 text-xs text-ink-muted">
        {note ? note.text : 'Even across the week — no day stands out.'}
      </p>
    </div>
  )
}
