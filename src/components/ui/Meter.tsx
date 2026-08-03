/**
 * A proportion, drawn.
 *
 * `aria-hidden`, always: a meter here never appears without the number it depicts
 * sitting next to it, so announcing it again would only make a screen reader say
 * everything twice.
 *
 * The fill is clamped at 1 — a goal can be exceeded, and a bar cannot.
 */
export default function Meter({
  fraction,
  color = 'var(--color-accent)',
  className = '',
}: {
  fraction: number
  /** Usually an activity's own colour. Defaults to the accent. */
  color?: string
  className?: string
}) {
  return (
    <div aria-hidden className={`mt-2 h-2 overflow-hidden rounded-full bg-recess ${className}`}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(1, Math.max(0, fraction)) * 100}%`,
          backgroundColor: color,
        }}
      />
    </div>
  )
}
