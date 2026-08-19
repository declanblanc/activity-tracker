/**
 * One sentence about two activities whose days move together.
 *
 * **Never a claim of cause, and the panel says so where the reader will see it.** The
 * arithmetic behind it (`correlate.ts`) refuses anything under five overlapping days or an r
 * under 0.15, and reports a magnitude — "34m longer" — rather than a coefficient, because that
 * is the half a reader can act on. What it cannot do is tell which way round it runs, or
 * whether a third thing drives both.
 *
 * Absent entirely when there is nothing that clears the bar, which is most of the time.
 */
export default function WorthALook({ sentence }: { sentence: string | null }) {
  if (!sentence) return null

  return (
    <div className="panel mt-4 p-4">
      <h2 className="flex items-baseline gap-2 text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Worth a look
        <span className="ml-auto font-normal tracking-normal normal-case">not a cause</span>
      </h2>
      <p className="mt-2 text-sm leading-5 text-ink-soft">{sentence}</p>
    </div>
  )
}
