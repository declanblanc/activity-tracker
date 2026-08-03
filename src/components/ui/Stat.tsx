/**
 * One number with a label under it, as a `<dl>` term-and-definition pair.
 *
 * Extracted from the habit sheet because the focused Insights view shows the same trio for a
 * count activity — where "share of tracked time" is meaningless and Current / Longest / Total
 * is what there is to say.
 *
 * The caller supplies the `<dl>`, so a row of these is one list rather than three.
 */
export default function Stat({
  label,
  value,
  unit,
}: {
  label: string
  value: string | number
  /** The unit, small and beside the number. Omitted when `value` already carries one. */
  unit?: string
}) {
  return (
    <div className="rounded-xl bg-raised py-3 text-center">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-2xl font-bold tabular-nums text-ink">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-ink-muted">{unit}</span>}
      </dd>
    </div>
  )
}
