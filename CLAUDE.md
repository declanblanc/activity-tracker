# Activity Tracker

Local-first, single-user, mobile-first installable PWA. One entity — `Activity` — tracked either
by **checking it off each day** or by **running a timer**, with everything else shared between the
two. See [README.md](README.md) for the shape of it and [PLAN.md](PLAN.md) for how the two
predecessor apps (`../time-tracker`, `../habit-tracker`) were merged into it.

**Four npm scripts, always green:** `typecheck`, `lint`, `test`, `build`.

## Non-obvious constraints

These are the ones that look wrong until you know why. All are settled decisions.

- **`measure` is branched on in exactly one place**, `dayAmounts` in `lib/days.ts`. Everything
  downstream — `periodAmounts`, `streaks`, the goals panel — sees one amount per day and must stay
  measure-agnostic. A second `measure ===` in `lib/` is a smell. A screen may branch on it to
  decide *which components to render*, which is how the grid stays check-off-only; what it may not
  do is compute two different numbers. The other exceptions are `formatAmount` (the last step
  before rendering, which has to put a unit on a bare number) and `FocusSummary` (the two measures
  genuinely have different things to say). `digest.ts`, `correlate.ts` and `rhythm.ts` take a
  `measure` but never branch on it — they hand it straight to `formatAmount` so a sentence can
  carry a unit, which is that same last step and not a second code path.
- **Every activity holds both axes; the sheet always shows both; `display` is the card's alone.**
  Storage never cared — completions and entries were always both allowed on any activity. So the
  activity sheet renders both the check-off grid and the timer for *every* activity, unconditionally;
  it is the full view and branches on nothing. `display` (`'habit' | 'timer'`) decides one thing
  only: which card the Activities list draws. **One choice, not two flags** — that list draws one
  card per activity, so the pair of booleans this replaced had a "both" state it could not honour,
  and in practice nothing read them: the list split on `measure`, so a card asked for as a timer
  came out a heat map. Nothing outside that one screen reads `display`; Today and Insights ask the
  records instead, since any activity may hold intervals. `measure` is a separate thing: the
  *scored* axis — the one the single goal, the streak and the "total" are about, and the axis the
  sheet leads its layout with. The two are **decoupled**: a card can be a timer while the goal is
  scored on the check-off, which is why a habit card draws `gridAmounts` (the check-offs) rather
  than the scored amounts. `measure` never reaches `lib/`: `dayAmounts` still branches on it alone,
  so the one-amount-per-day core and the streak/goals stay axis-agnostic. A *second* scored series
  (two goals) is the thing deliberately *not* built: it would force `dayAmounts` to compute two
  numbers and undo the whole measure-agnostic downstream. `display` is optional on the type only so
  a blob exported before it existed imports unchanged — `displayMode` in `data/types.ts` reads
  `measure` for such a record; every stored record has one, since the Dexie v2 upgrade folded the
  old flag pair into it.
- **`HeatGrid` is for check-off activities only**, and takes a colour and a weekly target rather
  than an `Activity` so there is nothing in it to branch on. A contribution square is on or off,
  which throws away the quantity that is the whole point of a timed activity. Timed history lives
  in the sheet's own entry list, the Today timeline and the Insights trend.
- **An activity's history and its corrections live in its sheet**, not on a screen of their own.
  `ActivitySheet` owns the entry-list draft state, so closing the sheet discards a half-typed
  correction and no screen has to know one was in progress. The list is sliced from the year the
  dashboard already read, which is why the same horizon bounds the list, the streak and the total.
  There is deliberately no cross-activity history: that was a Log screen, and it was dropped.
- **Never write `null` to an indexed field.** `null` is not a valid IndexedDB key: a record with
  one silently disappears from that index, and `.equals(null)` throws. Open-ness and liveness use
  the numeric sentinels `OPEN_ENTRY_END` and `NOT_DELETED`. Booleans are not valid keys either,
  which is why `archived` and `done` are unindexed. Only `src/data/` knows the sentinels exist;
  export translates them back to `null`.
- **`done: false` is a `Completion`'s tombstone, and a real stored value.** The row records that a
  decision was made; only `done` says which way. Never `done ?? true`, never `!!done`, never drop
  the row — any of those turn a deliberately cleared day back into a completed one. It also
  outranks the clock: see the next bullet.
- **Tracked time checks the day off, and nothing overrules it.** `completionAmounts` credits a
  day with any tracked time as done — a day you ran the timer on is a day you did the thing, so
  it fills its square and feeds the streak without also asking for a tap. That is what makes the
  two axes one habit rather than two ledgers side by side. A `done: false` row on such a day is
  **inert**, whichever order the two records arrived in; the earlier rule that let it win in
  either direction is what produced the bug where a day was timed and stayed unchecked forever,
  with nothing on screen saying why. The interval is the record that the day happened, so
  deleting the time is the only way to take the day back — and the un-check tap on a tracked
  square writes nothing and returns the reason instead (`toggleDay` in `Activities.tsx`). That
  reason is rendered twice because it must be: a card shows it as a toast, and the sheet shows it
  under its grid, since the sheet is a native `<dialog>` in the top layer and a docked toast
  fired from inside it would be painted underneath. `done: false` remains the tombstone and the
  whole of the un-log gesture on an *untracked* day. Two consequences of the credit itself: it is
  bounded by the `days` handed in (completions arrive whole, time does not), which is why a
  screen derives its grid and its entries read from one range; and there is **no
  `toggleCompletion`** — flipping the stored row would make the first tap on a timer-credited day
  appear to do nothing, so callers pass the state they can see to `setCompletion`.
- **A `Completion`'s id is derived** from `activityId` and `day`, which makes
  one-row-per-activity-day structural. Import *recomputes* it rather than trusting the file.
- **Window reads anchor on `endedAt`, not `startedAt`.** An interval intersects a window when
  `endedAt > rangeStart AND startedAt < rangeEnd`. "Entries that started inside the window"
  silently drops the sleep entry that ran 23:00→07:00.
- **One week start, `WEEK_STARTS_ON` in `lib/time.ts`.** `weekWindow` and `weekGrid` both read it.
  If they ever disagree, a shaded heat column scores a different week than the goals panel does.
- **Timers are flat.** No timer runs inside another. Per-activity totals overlap freely and can
  exceed wall-clock; the union counts shared time once. The two numbers answer different
  questions — do not reconcile them.
- **Two merge rules that look like one.** The wall-clock union merges intervals that merely
  *touch*. Same-activity storage merging requires *strict* overlap, leaving abutting records
  separate. Conflating them is the easy mistake.
- **The accounting window clamps to `now`.** Otherwise a fully-tracked morning reports 15h
  untracked at 09:00.
- **A part period is never measured against a whole one; `lib/pace.ts` is the only comparison.**
  Every delta on Insights used to read `current` against the closed period before it, so the first
  six days of every week reported a collapse — "48h 37m down" on a Tuesday morning, four times over
  in the breakdown alone — and the trend's mean line included the stub it was the baseline for.
  `pace` pairs the same count of **closed days** on each side. A day is the finest amount
  `dayAmounts` names, so a day still running is on neither side; on the day scale nothing has
  closed and `comparison` is `null`, which callers render as *no delta at all* rather than a wrong
  one. `leadingTotals` is the same rule for a rank: it cuts every past period to the same first N
  days before placing this one among them. `onPace` asks for the closed days' worth and not the
  day in progress, so "behind" means the period has already slipped rather than that it is early
  in the morning.
- **A panel that has nothing to say renders nothing, and that silence is load-bearing.**
  `Highlights`, `WorthALook`, `Standing`'s rank row and `describeRhythm` all return null rather
  than manufacture a finding, and the thresholds that make them do so are deliberate: a mover
  needs a 30% swing at the week or month scale (a single day against a ten-day average is a coin
  toss), a correlation needs five overlapping days and |r| ≥ 0.15, a rhythm needs every weekday
  seen three times. A digest that always says four things is the furniture this screen was.
  Two related traps, both hit and both fixed: a mover's baseline starts at the activity's **first
  record**, since periods before it existed are not quiet periods, and `WhatGotDone` hides at the
  day scale, where every row is 1 of 1 and a full bar means "goal met" everywhere else in the app.
- **Targets are scored only at their own period.** A 10h/week target shows no goal on the day or
  month scale. No pro-rating.
- **A streak skips an in-progress period, unless it has already met its target** — then it counts
  immediately. Waiting for the period to close would mean ticking today never moves the number,
  which is the point of a contribution grid.
- **Entries are closed, never reopened.** This is what keeps one-open-entry-per-activity
  enforceable by the start/stop path alone.
- **A merge resolves duplicate open entries, it does not refuse them.** Two devices can each
  start the same timer offline, so `resolveDuplicateOpenEntries` keeps the latest start open and
  closes each earlier one where the next began — restamping `updatedAt`, which is what makes the
  fix win on the device that has not merged yet. Throwing instead (the earlier behaviour) wedges
  sync permanently, because the same pair arrives on every later attempt.
- **Sync is a whole-database blob, and the server never parses it.** `sync.ts` downloads the
  blob, hands it to `importJson` — whose `winner()` already resolves last-write-wins per record —
  and uploads the merged export. There is no watermark and no server-side schema, so a new field
  on a type needs no migration. `syncToken` is device-local on purpose: it is the one value that
  must never travel inside the blob.
- **Both halves of a sync are conditional on the blob's version, and neither is optional.** The
  version is the blob's server `updatedAt`; each device remembers the one it merged in
  `mergedServerVersion`. The download sends it as `If-None-Match`, so a poll that finds nothing new
  answers `304` and moves no database at all — which is the only reason polling every few seconds is
  affordable. The upload sends it as `If-Match`, so a merge built on a blob another device has since
  replaced is refused and rebuilt instead of overwriting it. The second is *load-bearing because of*
  the first: the upload used to be unconditional, and that re-upload-every-time was what healed the
  lost-update race by accident. The compare-and-swap heals it on purpose, which is what allows the
  upload to be skipped when nothing local is new. A device that has just merged another's change
  reads it as newer than anything it has sent and echoes the blob back once — intended, since that
  echo is what carries records the sender lacked, and it does not repeat.
- **The second trigger is the database itself.** `onLocalChange` in `db.ts` is a `liveQuery` over the
  newest `updatedAt` in all three tables, so an edit made here uploads at once rather than waiting
  out the poll; `latestLocalChange` is also the whole upload decision. Between the two, no mutation
  has to remember to announce itself — the property the interval was originally chosen for.
- **`deleteAllData` forgets `mergedServerVersion`.** Otherwise the next sync reads this device's own
  emptiness as agreement with the server, `304`s, and the data does not come back — which is what
  the Settings copy promises while the token is still there.
- **An activity's `measure` — its scored axis — *can* change.** It once could not, because records
  were thought to be shaped by it; they are not (every activity may hold both check-offs and
  intervals), so the measure is only a scoring choice. The one consequence is the goal: a days
  target cannot be read as an hours one, so moving the measure across axes clears it. The form does
  that. The measure is **not** tied to what the card shows — the goal can be scored on an axis the
  card hides — so `saveActivity` does not check the two against each other at all.
- **A running timer looks the same on both cards, and `CardShell` owns it.** Tint, rail and the
  breathing halo on the identity dot are one `running` prop, so a habit card says it too — any
  activity's timer can be started from its sheet, and the habit card is the one with no control to
  say so. The halo's dim end is floored at 50% of the activity colour: it carries state, so it owes
  3:1 at *every* frame, not just its brightest. Its resting declaration is the bright frame on
  purpose — the global `prefers-reduced-motion` rule lands an animation on its final frame, so that
  frame has to be the one that still reads as running.
- **`activity-tint` never shares an element with `panel`.** The tint sets `background-color`, so
  it replaces the panel's fill instead of sitting on it. A card is two nested elements for this.
  A tinted card also re-tints its **empty** heat squares by the same 8%: the square is opaque
  `raised`, so when the tint moved the fill under it the step between them collapsed to 1.00:1 —
  identical luminance, and the grid disappeared under a running timer. Tinting the square's own
  base restores the untinted 1.18:1.
- **Deleting an activity is a labelled button in its sheet, and only that.** There was a
  swipe-to-delete on the card; it read `pointercancel` as a completed swipe, and since a touch
  that turns into a vertical scroll cancels the pointer, scrolling the dashboard deleted
  activities. A destructive action does not hang off a gesture the card has to guess at.
- **The app shell is `h-dvh` and `<main>` is the scroll container**, not the document. Today's
  timeline asks for exactly the height left over, and a percentage height only resolves inside a
  flex item whose own height is definite — `min-h-dvh` is not. Any screen taller than the viewport
  scrolls inside `<main>`; the tab bar and the `docked` toasts are fixed and do not notice.
- **On Today, the bar container is `pointer-events-none` and each bar restores it.** The container
  spans the whole day whatever its bars do, so without that it swallows every click meant for the
  empty space behind it — which is what adds an entry.

## Conventions

- UI never imports Dexie. All persistence goes through `src/data/*.ts` — the single swap point if
  cloud sync ever lands.
- Three tiers of state, each piece in exactly one: **Dexie** for domain data, **`data/prefs.ts`**
  for persisted device settings (the only `localStorage` in the app), **component state** for the
  ephemeral rest.
- `lib/accounting/` is pure — no Dexie, no React, no date-fns — and operates on numbers.
  `lib/days.ts` is the one module allowed to bridge it to the calendar.
- Calendar math goes through date-fns in `lib/time.ts`. No hand-rolled `Date` arithmetic for
  day/week/month boundaries anywhere else.
- Every mutation stamps `updatedAt`. Deletes are soft (`deletedAt`), never physical.
- Tests are Vitest, colocated as `*.test.ts`, `node` environment, TZ pinned to
  `America/Los_Angeles` so DST assertions mean the same thing on CI. Dexie tests import
  `fake-indexeddb/auto`.
- Colour reaches an element through one `--activity` custom property, and never sits under text:
  the 8% ceiling on `activity-tint` is measured, not a preference. See `src/index.css`.
- `ponytail:` comments mark deliberate simplifications, and name the ceiling and the upgrade path.

## Verifying UI work

The contrast probe is the one check worth re-running after any styling change: composite every
background down the ancestor chain onto a 1×1 canvas, because `getComputedStyle().backgroundColor`
returns unresolved `oklab(… / 0.08)` for the tint and garbage numbers if you use it directly. The
targets are 4.5:1 for text and 3:1 for a graphic that carries state — which is what set the heat
square's 60% partial fill.
