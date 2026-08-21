/**
 * How much of a time-based goal you should have done by now — the owed side of the
 * tracked-vs-owed comparison the Pace panel draws.
 *
 * Pure over numbers, like the rest of `lib/`: it never sees an activity and has no measure to
 * branch on. Only a duration goal has an owed amount worth prorating — a check-off deficit is
 * unrecoverable and so meaningless — but nothing here enforces that; the caller does.
 *
 * **This is the proration the app used to forbid, on purpose.** The old rule refused to score a
 * target anywhere but its own period. That rule still stands for *scoring a goal* — the Goals
 * panel shows no weekly goal at the day scale. What it does not get to forbid is *owing*: a
 * 40h/week commitment three-and-a-half weeks in has earned 140h of debt whether or not the
 * current week has closed, and saying so is the whole point of this screen. The part-against-
 * whole guard in `pace.ts` is a different thing and is untouched: that compares one period's
 * total against another's, where a partial-vs-whole reading really is a lie.
 */

/**
 * The amount owed after `elapsedMs` of wall-clock, for a target of `targetAmount` per `periodMs`.
 *
 * Linear: two hours a day owes one hour by noon. `elapsedMs` clamps at zero so a window whose
 * start is still in the future owes nothing rather than a negative amount. A zero-length period
 * owes nothing — the caller has no rate to apply.
 */
export function expectedSoFar(targetAmount: number, periodMs: number, elapsedMs: number): number {
  if (periodMs <= 0) return 0
  return targetAmount * (Math.max(0, elapsedMs) / periodMs)
}
