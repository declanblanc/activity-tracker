import type { Highlight } from '../../lib/digest.ts'

/**
 * The handful of sentences worth reading first.
 *
 * Insights used to render the same four panels in the same order whether the week was a
 * record or the app had just been installed — no number on it was ever ranked against any
 * other, and nothing anywhere said which of eight activities to look at. Everything here is
 * drawn from numbers the panels below already show; the work is in choosing and ordering
 * them, which `digest.ts` does.
 *
 * Renders nothing at all when there is nothing to say. A quiet period should look quiet,
 * not like a panel that failed to load — and a highlights strip that manufactures a
 * highlight every time is furniture again.
 */
export default function Highlights({ highlights }: { highlights: Highlight[] }) {
  if (highlights.length === 0) return null

  return (
    <div className="panel mt-4 p-4">
      <h2 className="text-2xs font-semibold tracking-widest text-ink-muted uppercase">
        Worth knowing
      </h2>
      <ul className="mt-1 flex flex-col">
        {highlights.map((highlight) => (
          <li
            key={highlight.text}
            className="flex items-start gap-2.5 border-t border-line-subtle py-2.5 first:border-t-0"
          >
            {/* Decorative: the sentence beside it already says everything the glyph hints at. */}
            <span aria-hidden className="shrink-0 leading-5">
              {highlight.icon}
            </span>
            <p className="min-w-0 text-sm leading-5 text-ink-soft">{highlight.text}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
