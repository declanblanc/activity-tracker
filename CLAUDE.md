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
  genuinely have different things to say).
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
  the row — any of those turn a deliberately cleared day back into a completed one.
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
- **An activity's `measure` cannot change** once it exists. Its records are shaped by it, and the
  goal's unit means something different under each. Archive and add a new one instead.
- **`activity-tint` never shares an element with `panel`.** The tint sets `background-color`, so
  it replaces the panel's fill instead of sitting on it. A card is two nested elements for this.
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
