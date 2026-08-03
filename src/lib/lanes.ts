/** A half-open interval `[start, end)`, in whatever unit the caller is using. */
export type Span = { start: number; end: number }

/**
 * Pack spans into the fewest lanes such that no two spans in a lane overlap, and
 * return the lane index of each span, parallel to the input.
 *
 * Spans that merely touch (one's end equals the next's start) share a lane — they do
 * not overlap, so nothing is hidden by drawing them in line. This is the same
 * touching-versus-overlapping distinction the accounting layer draws, applied to
 * pixels rather than to totals.
 *
 * The greedy first-fit sweep is optimal for interval-graph colouring: processing in
 * start order, the number of lanes in use never exceeds the number of spans genuinely
 * overlapping at some instant.
 */
export function assignLanes(spans: Span[]): number[] {
  /** Where each open lane is occupied until. */
  const laneEnds: number[] = []
  const lanes = spans.map(() => 0)
  const byStart = spans.map((_, index) => index).sort((a, b) => spans[a].start - spans[b].start)

  for (const index of byStart) {
    const { start, end } = spans[index]
    let lane = laneEnds.findIndex((occupiedUntil) => occupiedUntil <= start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = end
    lanes[index] = lane
  }

  return lanes
}

/**
 * How many lanes each span has to share its width with — the widest crowd it is ever
 * part of, not the widest crowd in the whole set.
 *
 * A single figure for the whole day was the bug this replaces: one two-lane overlap at
 * 09:00 halved every bar's width for all twenty-four hours, so a solitary evening entry
 * was drawn at half width against nothing. A span's width should answer "how many things
 * were happening at once *here*".
 *
 * Transitively, through the spans it touches: A overlapping B and B overlapping C puts A
 * and C on the same denominator even where they do not meet each other, because
 * otherwise B would be drawn at two different widths down its own length. The result is
 * the maximum lane count over each connected cluster of overlapping spans.
 *
 * ponytail: O(n²) over a day's entries — fifty on a heavy day. A sweep would be O(n log
 * n) and three times the code; revisit if a day ever holds thousands.
 */
export function laneSpans(spans: Span[], lanes: number[]): number[] {
  /** Cluster id per span, assigned by walking overlaps. */
  const cluster = spans.map(() => -1)
  let next = 0

  const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end

  for (let seed = 0; seed < spans.length; seed++) {
    if (cluster[seed] !== -1) continue
    const id = next++
    // Breadth-first over the overlap graph. `queue` grows as members are found, so a
    // chain A–B–C lands wholly in one cluster.
    const queue = [seed]
    cluster[seed] = id
    while (queue.length > 0) {
      const member = queue.pop()!
      for (let other = 0; other < spans.length; other++) {
        if (cluster[other] === -1 && overlaps(spans[member], spans[other])) {
          cluster[other] = id
          queue.push(other)
        }
      }
    }
  }

  const widthOf = new Array<number>(next).fill(1)
  spans.forEach((_, index) => {
    widthOf[cluster[index]] = Math.max(widthOf[cluster[index]], lanes[index] + 1)
  })

  return spans.map((_, index) => widthOf[cluster[index]])
}
