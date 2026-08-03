# activity-tracker — merge time-tracker and habit-tracker

> **Note on the plan file location.** You asked for this at `activity-tracker/PLAN.md`. Plan
> mode only lets me write to this file, so **step 1 of implementation is to copy this
> document to `/Users/dblanchard/dev/personal/activity-tracker/PLAN.md`** before any code.

## Context

`time-tracker` and `habit-tracker` are two local-first PWAs built on the same toolchain
(Vite 8, React 19, TS, Tailwind v4, oxlint, vitest, vite-plugin-pwa) that solve the same
problem from two ends. habit-tracker asks *did I do it today* and draws a GitHub-style
heatmap. time-tracker asks *how long did I do it for* and draws timelines, logs, and
insights. Running both means two dashboards, two exports, two settings screens, and no
way to see a habit's streak next to a timer's goal.

`activity-tracker` (currently an empty directory) becomes the single app. habit-tracker
supplies the UI — card grid, heat grid, native-`<dialog>` sheets, emoji icons, fixed
palette. time-tracker supplies the engine — Dexie, the accounting library, and the four
screens habit-tracker never had.

The intended outcome: one dashboard where a check-off habit and a running timer sit side
by side as cards, both showing a heat strip and a streak, both scored by one goals panel.

### Decisions already made

| | |
|---|---|
| **Model** | One `Activity` with `measure: 'count' \| 'duration'`. Count = checked off per day (old habits). Duration = start/stop timer (old activities). Everything else shared. |
| **Storage** | Dexie/IndexedDB, db name `activity-tracker`. habit-tracker's localStorage store is deleted. |
| **Theme** | Dark only. habit-tracker's light mode and `useTheme` are dropped; time-tracker's semantic token layer survives. |
| **Navigation** | react-router, five screens, sidebar/bottom-bar. Home is the card dashboard. |
| **Migration** | **None.** No legacy import adapters. Data goes in by hand — the paths already exist (click any past heat square to backfill a check-off; Log → `+ Add` for a timed entry). |
| **Repo** | Fresh `git init`. No history from either parent. |

---

## Part 1 — Data layer

### 1.1 `src/data/types.ts` (rewritten from both apps' type files)

```ts
export const OPEN_ENTRY_END = Number.MAX_SAFE_INTEGER
export const NOT_DELETED = 0
export function newId(): string { return crypto.randomUUID() }

/** `YYYY-MM-DD`, always from *local* calendar parts. */
export type DateKey = string

/**
 * The three period sizes everything is read at, and the size a target is set at. One type,
 * not two: time-tracker kept `Scale` and `TargetPeriod` structurally identical but
 * separate, and every use compared them with `===` anyway.
 */
export type Period = 'day' | 'week' | 'month'

/**
 * How an activity is recorded — the only field that changes what the rest of the app does
 * with it. Everything else (icon, colour, target, archive, order, soft delete, the heat
 * grid, the streak, the goals panel) is shared. That sharing is the whole merge.
 */
export type Measure = 'count' | 'duration'

export type Activity = {
  id: string
  name: string
  /** Optional prose. The sheet shows it; nothing computes on it. */
  description?: string
  color: string        // hex, from lib/palette.ts
  icon?: string        // emoji
  measure: Measure
  /**
   * The goal, in the unit the measure counts in: **days** for `count`, **milliseconds**
   * for `duration`. Absent means no goal.
   */
  targetAmount?: number
  targetPeriod?: Period
  archived: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
  /** `NOT_DELETED`, or the tombstone timestamp. Never `null`. */
  deletedAt: number
}

/**
 * One day's decision about one `count` activity.
 *
 * The presence of a row means "a decision was recorded"; `done` is what it was. `done:
 * false` is a real value and this table's tombstone — an un-log — not an absence. Without
 * it, a stale row could resurrect a day the owner deliberately cleared.
 *
 * No `deletedAt`: `done: false` already is the tombstone, and a second one would need a
 * rule about which wins. No `createdAt`: nothing displays it.
 */
export type Completion = {
  /** `${activityId}:${day}` — derived, so one activity-day can never hold two rows. */
  id: string
  activityId: string
  day: DateKey
  done: boolean
  updatedAt: number
}

export const completionId = (activityId: string, day: DateKey) => `${activityId}:${day}`
```

`Entry`, `EntryInput`, `ActivityInput`, `isOpen`, `isLive` port from
[time-tracker types.ts](../../dev/personal/time-tracker/src/data/types.ts) — `Entry`
verbatim, `ActivityInput` gaining `measure`/`description`/the renamed target fields.

**habit-tracker's `weeklyTarget` maps as:** `7 → { targetAmount: 1, targetPeriod: 'day' }`,
`n` in 1–6 `→ { targetAmount: n, targetPeriod: 'week' }`. `weeklyTarget: 7` meant *daily*,
not seven-per-week — its `isWeekMet` deliberately never fires. The new model can express
the literal `{ 7, 'week' }` that the old one could not; the form must never produce it
("Every day" vs "N days a week", 1–6).

### 1.2 `src/data/db.ts`

```ts
this.version(1).stores({
  activities: 'id, sortOrder, updatedAt, deletedAt',
  entries: 'id, activityId, startedAt, endedAt, [activityId+endedAt], updatedAt, deletedAt',
  // `done` is deliberately NOT indexed — booleans are not valid IndexedDB keys, so
  // `done: false` would vanish from that index, and `false` is a value this table must
  // keep. No `activityId` index either: the primary key *starts* with the activity id, so
  // `where('id').startsWith(`${activityId}:`)` is already a prefix scan on it.
  completions: 'id, day, updatedAt',
})
```

Keyed by a **derived string `id`**, not a compound primary key `[activityId+day]`: a
compound PK enforces uniqueness just as well but leaves the record with no `id`, and
`transfer.winner<T extends { id; updatedAt }>` — the one LWW rule all three tables share —
needs one. Cost is one redundant field.

**Do not model a check-off as a zero-length `Entry`.** `saveEntry` rejects
`endedAt === startedAt`, a check-off has no time of day, and an interval would drag counts
into `trackedWallClock`/`untracked`.

### 1.3 Calendar modules — one, not two

habit-tracker's `lib/dates.ts` is hand-rolled local-parts math; time-tracker's convention
is date-fns in `lib/time.ts`. Two tested calendar modules is one too many, and date-fns is
already a dependency.

**`src/lib/time.ts` absorbs the `DateKey` helpers, reimplemented on date-fns:** `dateKey`,
`parseKey`, `shiftKey`, `formatKey`, plus the existing `TimeWindow`/`dayWindow`/
`weekWindow`/`monthWindow`/`trailingWindows`/datetime-local conversions. `weekGrid` moves
to `lib/heatStrip.ts`, next to the `SQUARE`/`GAP`/`weeksThatFit` geometry it serves.
`lib/dates.ts` is not ported as a file; **its tests are re-homed into `time.test.ts`,
still pinned to `America/Los_Angeles`** — both bugs they cover are live in the new app
(`toISOString()` filling tomorrow's square; `± 86_400_000` corrupting streaks twice a year).

**Pin the week start explicitly:** `startOfWeek(at, { weekStartsOn: 0 })`, with a comment
naming `weekGrid`. time-tracker's bare `startOfWeek(at)` is Sunday only because date-fns
defaults to en-US; if a locale is ever configured, `weekWindow` moves to Monday while the
grid stays on Sunday and column shading silently disagrees with week scoring.

### 1.4 `src/lib/days.ts` (new) — the measure branch, in one place

The only module importing both the calendar and the accounting library. Not in
`lib/accounting/`, which stays pure over numbers with no date-fns.

```ts
/**
 * day → amount, for one activity: **1 per logged day** when it is counted,
 * **milliseconds tracked in that local day** when it is timed. Missing key = zero.
 *
 * This is the single per-day signal, and the only place `measure` is branched on. The heat
 * grid shades a square from it, `periodAmounts` sums it into weeks and months, and
 * `streaks` scores those — so past this line neither measure has a code path of its own.
 *
 * An *amount* rather than a boolean, so a duration square can shade partially for free.
 */
export function dayAmounts(
  activity: Activity, entries: Entry[], completions: Completion[],
  days: TimeWindow[], now: number,
): Map<DateKey, number>

/**
 * Did this day count? A day with a target of its own has to reach it; anything else is a
 * hit on any amount at all — which is what a filled square meant before targets existed.
 */
export function dayMet(activity: Activity, amount: number): boolean

/**
 * The day amounts summed inside each window, oldest first — exactly `streaks`'s input, and
 * exactly the whole-column shading a weekly target needs.
 */
export function periodAmounts(
  amounts: Map<DateKey, number>, windows: TimeWindow[],
): ScoredPeriod[]
```

`dayAmounts`'s count branch filters on `row.done === true`, never truthiness — treating
`false` as absence is how an un-logged day comes back to life. Its duration branch goes
through `bucketTotals`, which already clips an entry spanning midnight, ends an open entry
at `now`, and refuses the future; the day key comes from `dateKey(new Date(window.start))`
— `window.end` is tomorrow's midnight and would name the wrong day.

Summing days into weeks is *exact* for both measures: local days partition a local week
with no gap or overlap, and one activity's intervals are disjoint by construction
(`saveEntry` folds any overlap). Holds across a 167h or 169h DST week.

`src/lib/time.ts` gains `dayWindowsIn(range)`, stepped by `dayWindow(previous.end)` and
never a fixed 24 hours, so the 23h and 25h days are what they really are.

### 1.5 Goals and streaks unify — `src/lib/accounting/goals.ts`

**`habit-tracker/src/lib/stats.ts` is deleted.** The two implementations are the same rule
plus one term: `stats.currentStreak` = `closedRun + (inProgressMet ? 1 : 0)`. Both already
agree that an in-progress period which hasn't met its target is *skipped*, not a miss.

**They conflict on whether an already-met in-progress period counts, and habit-tracker
wins.** time-tracker breaks out of the loop the moment a period is in progress, so ticking
today never moves the number until tomorrow — for a habit tracker that deletes the
product. Its stated reason (a streak must not flicker up and back down within a period)
only bites when a total *decreases* mid-period, which requires a hand edit.

```ts
export function streaks(periods: ScoredPeriod[], target: number, now: number) {
  let current = 0
  let longest = 0
  for (const period of periods) {
    if (period.window.end > now) {
      // In progress, and so is everything after it. A period that has *already* met its
      // target counts immediately — ticking the last box of the day is exactly when the
      // number is supposed to move.
      if (period.total >= target) { current += 1; longest = Math.max(longest, current) }
      break
    }
    current = period.total >= target ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return { current, longest }
}
```

`targetAt` is unchanged but for the field rename. Translation table for the deleted
`stats.ts`:

| `stats.ts` | replacement |
|---|---|
| `isWeekly(weeklyTarget)` | `activity.targetPeriod === 'week'` |
| `weekStart(key)` | `weekWindow(at)` |
| `weekCount(days, key)` | `periodAmounts(amounts, [weekWindow(at)])[0].total` |
| `isWeekMet(...)` | `total >= targetAt(activity, 'week')` |
| `isDone(days, key)` | `dayMet(activity, amounts.get(day) ?? 0)` |
| `currentStreak`/`longestStreak` | `streaks(periodAmounts(amounts, windows), target, now)` |
| `totalCompletions(days)` | `completions.filter((c) => c.done).length` at the call site |

So "3 days of 5 this week" and "2h45m of 4h today" go through
`targetAt` → `periodAmounts` → `streaks` with no branch.

### 1.6 `src/data/completions.ts` (new — replaces habit-tracker's `store.ts`)

```ts
export async function getCompletions(): Promise<Completion[]>
export async function toggleCompletion(activityId: string, day: DateKey): Promise<boolean>
export async function setCompletion(activityId: string, day: DateKey, done: boolean): Promise<void>
```

`toggleCompletion` reads-then-writes inside one `db.transaction('rw', db.completions, …)`
so a double tap cannot land two writes out of order; it writes `done: false` rather than
deleting the row, and stamps `updatedAt` like every other mutation.

**`getCompletions` reads the table whole, deliberately** — this is what keeps a count
activity's total and streak all-time, matching habit-tracker. Only the *entries* read is
bounded by a horizon.

```
// ponytail: the completions table is read whole. At ~45 bytes a row, eight counted
// activities over five years is ~15k rows — which is what habit-tracker already held in
// one React state object. If it ever measures slow, range on `day`.
```

`data/entries.ts` ports **verbatim**. `data/activities.ts` ports with validation extended
for `measure` and a count-target ceiling:

```ts
/**
 * The largest `count` target a period can hold. "Nine days a week" can never be met, so it
 * is not a goal — habit-tracker clamped the same 1–7 range on load.
 *
 * ponytail: `month: 31` lets "31 days in February" through, which reads as a miss every
 * February. Fixing that needs the specific month, which a validator does not have.
 */
const MAX_COUNT_TARGET: Record<Period, number> = { day: 1, week: 7, month: 31 }
```

`softDeleteActivity` leaves completions alone, exactly as it leaves entries alone.

`entries.ts` will **not** guard against a timer started on a count activity — that check
needs an activities read inside the entries transaction, and the only route to it is a
hand-edited import. Document it: a stray entry on a counted activity is invisible
(`dayAmounts` ignores entries for `count`) rather than wrong.

### 1.7 `src/data/prefs.ts` and `src/data/transfer.ts`

Prefix `activity-tracker.`; still the only module touching `localStorage`. `insightsScale`,
`forgottenPromptSnoozedUntil`, `blockStartedAt` (pause-vs-stop) and
`resumableBlockStartedAt` (undo-a-stop) all survive — the last two are features 7 and 25,
not incidental UI state. `syncEnabled`/`syncWatermark` are dropped (sync exists in neither
app; a localStorage key costs nothing to add later). habit-tracker's theme key is dropped.

`transfer.ts` ports from time-tracker with a third table. `FORMAT_VERSION = 1` — new app,
new format, **no legacy adapters**. Every existing guarantee is kept: null at the file
boundary, whole-file validation before any write, one transaction, tombstones exported,
`winner()` for collisions, `assertOneOpenEntryPerActivity`.

`ExportedCompletion = Completion` — no translation needed, a small dividend of `done:
false` being the tombstone. Import-side rules specific to completions:

- **Recompute `id` from `activityId` + `day`** rather than trusting the file's. Deletes a
  whole class of malformed input with no validation branch. Must happen before `resolve`.
- Validate `typeof done === 'boolean'`. Never `done ?? true`, never `!!done` — the single
  easiest bug to introduce in this merge.
- Validate `day` against `/^\d{4}-\d{2}-\d{2}$/`.
- No referential check on `activityId` — consistent with entries, which already tolerate
  orphans.

**habit-tracker's `mergeStores` is deleted**; `winner()` subsumes it. One footnote at the
call site: completion ids are derived, so a tie pair has identical ids, the id tiebreak
degenerates, and `winner` returns the incoming record — the reverse of habit-tracker's
ties-to-base. A no-op in practice (same millisecond, same day, same tap).

CSV export: one file, columns `activity, measure, date, started, ended, duration_minutes,
note`. Count rows fill only the first three. `ponytail:` half-blank columns on count rows
beat two buttons and two functions; a spreadsheet filter on `measure` sorts it out.

---

## Part 2 — UI layer

### 2.1 Navigation — `src/App.tsx`

One `SCREENS` table drives routes plus both navs, as
[time-tracker App.tsx:29](../../dev/personal/time-tracker/src/App.tsx) already does.

| path | label | icon |
|---|---|---|
| `/` | **Activities** | `LayoutGrid` |
| `/today` | Today | `CalendarDays` |
| `/log` | Log | `ScrollText` |
| `/insights` | Insights | `BarChart3` |
| `/settings` | Settings | `Settings2` |

"Tracker" dies with its `Timer` icon — home no longer only tracks. The `/activities → /`
redirect and `Placeholder.tsx` are dropped (new app, no old links, all five routes real).
habit-tracker's header gear button is dropped; Settings is a route.

**Today keeps its tab even though it is duration-only.** Filtering `SCREENS` on "does a
duration activity exist" would change `grid-cols-5` to `grid-cols-4` as data changes,
moving every tab under the thumb. A decision against, not laziness.

### 2.2 The dashboard — `src/screens/Activities.tsx`

Replaces `Tracker.tsx` (678L). habit-tracker's card grid, holding both measures.

```
<section className="screen-pad mx-auto w-full max-w-3xl">
  header: h1 "Activities" + Button primary <Plus/> Add activity
  {anyDuration && <DaySummary … />}          // ported from Tracker.tsx:303
  {activities.length === 0 && <EmptyState … />}
  <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(20rem,100%),1fr))]">
     … CountCard | DurationCard per activity …
  </div>
  {archivedCount > 0 && <Button ghost aria-pressed={showArchived}>…</Button>}
  {toast && <Toast … />}
  <Modal><ActivitySheet …/></Modal>
  <Modal><ActivityForm …/></Modal>
</section>
```

Header is **not** sticky — the other four screens aren't, and on a phone it costs vertical
space the grid wants.

**One read set for the whole screen:** `getActivities(true)` (archived filtered in
memory), `getOpenEntries()`, `getEntriesInRange(readStart, OPEN_ENTRY_END)` where
`readStart = min(stripStart, today.start, …blockStartedAt, …openEntry.startedAt)` and
`stripStart` is 26 weeks back (`CARD_MAX_WEEKS`, the ceiling `useFittingWeeks` can ask
for), `getCompletions()` whole, and `blockStartedAt` mirrored into state.

```
// ponytail: six months of entries read on every open, every strip/streak/total derived
// from one O(n) pass. Ceiling: a *duration* streak longer than 26 weeks reads as 26.
// Count activities are unbounded because completions are read whole. Upgrade path: a
// per-day rollup table written on each stop, keyed [activityId+day].
```

**Three clocks, deliberately:** `useToday()` for the `DateKey` (a PWA left open across
midnight otherwise logs to yesterday's square), `useNow(30_000)` on the screen for
`DaySummary`, and `useNow(1000)` **inside `DurationSummary` only** — hoisting the
per-second tick would re-render twenty cards a second, most with nothing that moves. Same
reasoning `Insights.tsx:344` already gives for `RunningTimer`.

**Where time-tracker's three affordances land:**

- **`DaySummary`** ported unchanged, rendered only when an un-archived duration activity
  exists. It is *coverage of the day*, and a check-off contributes no time, so it can be in
  neither numerator nor denominator. `ponytail:` no count half — "4 of 6 done" is legible
  from the grid below.
- **Archived toggle** ported to the foot of the grid. Archived cards render at
  `opacity-50` with no action control and a **non-interactive strip** (`onDayActivate`
  undefined → `<div>`s, not buttons).
- **Reorder moves off the card into the sheet, relabelled "Move earlier" / "Move later".**
  Up/down arrows lie in an `auto-fill` grid: on three columns "up" moves the card left.
  This lets time-tracker's `⋯` `ActivityPanel` be dropped entirely — the sheet becomes the
  single per-activity manage surface.

Empty state, one action, because the measure fork happens inside the form:
> Nothing to track yet. An activity is either something you check off each day, or a timer
> you flip on and off. `[Add your first activity]`

### 2.3 The card — two components over shared internals

**`CountCard` and `DurationCard` in `src/components/ActivityCard.tsx`, over a shared
`SwipeToDelete` wrapper and a shared `useFittingWeeks` hook.** Rule: share the code that is
hard to get right, duplicate the markup that is easy to read.

One component with a branch loses on the props signature — it needs eight props a count
card ignores plus one a duration card ignores, and a discriminated union can't narrow from
a nested `activity.measure`, so it would need a redundant `measure` prop. Fourteen props,
half dead per instance. A shell with slots loses because the differing parts are the action
control *and* the summary *and* the square's ARIA semantics — three slots to save ~6 lines
of Tailwind.

```tsx
// src/components/SwipeToDelete.tsx — extracted from HabitCard.tsx:44-152
export default function SwipeToDelete({ onDelete, className, children }: {
  onDelete: () => void
  className?: string   // applied to the swiping surface, which is the card itself
  children: ReactNode
})
```

Owns the red underlay, `relative overflow-hidden rounded-2xl`, `TAP_SLOP`,
`commitDistance`, refs-not-state, `onPointerLeave` instead of `setPointerCapture`, and the
`onClickCapture` swallow. **Port all four explanatory comments verbatim** — each documents
a bug someone already hit. The swallow is what makes three buttons on a duration card safe.

```tsx
export function CountCard({ activity, amounts, today, onToggleDay, onOpen, onDelete })
export function DurationCard({ activity, amounts, today, startedAt, blockTotal, inBlock,
  todayTotal, onLogDay, onStart, onPause, onStop, onOpen, onDelete })
// DurationSummary is a component for exactly one reason: it owns useNow(1000).
```

Shared shell: `panel` surface, emoji chip + name + summary inside one
`<button onClick={onOpen}>` — *not* the whole card, which would fight every square below.
Fitted heat strip. Count card adds one 44px round toggle (`aria-pressed`, filled with
`activity.color` when done). Duration card adds Play/Pause (`aria-pressed`) + Stop
(`disabled` and **`invisible`** when `!inBlock`, so the name's width doesn't shift under
the thumb that just started the timer), and `activity-tint activity-rail` on the panel
while running.

Summary line, both measures, one function:

```
running (duration) → `{formatElapsed(blockTotal)} since {formatTime(startedAt)}`
paused  (duration) → `{formatDuration(blockTotal)} so far, paused`
week goal          → `{amount} of {target} this week · {n} week streak`
day goal / none    → `{n} day streak · {total}`
```

`{amount}`/`{target}`/`{total}` go through a new `formatAmount(measure, n)` in
`lib/format.ts` — `12` / `12 days` for count, `2h 10m` for duration.

Two card-level constraints: **the card's strip must never scroll** (`useFittingWeeks`
guarantees it — a horizontally-scrollable strip inside a horizontally-swiping card is two
gestures fighting), and **`activity-tint` must be verified under the grid** (a running
card tints its panel 8% with `--activity` while the empty square is `--color-raised`; if
they muddy, the tint drops on cards carrying a grid, not the square colour).

### 2.4 `src/components/ActivitySheet.tsx` — one component with a branch

The asymmetry with the card is deliberate: on the card the measure-specific part is most
of the interactive surface, in the sheet it is one block among six. Splitting would
duplicate ~60 lines for a ~15-line difference.

Identity + description + close · goal line (`Goal: 3× a week — 2 done so far this week.`) ·
`Stat` trio Current/Longest/Total, unit from the target period · duration-only running
controls, so a timer starts without closing the sheet · `HeatGrid weeks={53}`, scrollable ·
**`View insights` → `/insights?activity=<id>`** · footer `Edit` · `Move earlier`/`Move
later` · `Archive` · `Delete`.

Extract `Stat` from `HabitSheet.tsx:98` into `src/components/ui/Stat.tsx` — the focused
Insights view now uses it too.

**Conflict resolved:** habit-tracker's card title opened the sheet; time-tracker's row
title linked to `/insights?activity=`. **The sheet wins the tap** and carries the link —
it's faster (no route change, no lazy Recharts chunk, you stay on the grid), and the deep
link keeps working because the route is unchanged. The sheet must stay cheap: no Recharts,
no accounting beyond the 53-week grid.

### 2.5 `src/components/HeatGrid.tsx` — measure-aware

```tsx
export function HeatGrid({ color, measure, amounts, today, weeks, dayGoal, weekGoal,
                           onDayActivate }: {
  dayGoal: number        // the amount that fills a square
  weekGoal?: number      // absent = not scored by the week
  onDayActivate?: (day: DateKey) => void   // absent = non-interactive (archived)
})
```

Four changes: `done = (amounts.get(day) ?? 0) >= dayGoal` and `weekMet = weekSum >=
weekGoal` (one substitution makes the grid measure-agnostic — count gets `dayGoal: 1`, a
duration activity with a daily target gets that target, one with a weekly-or-no target
gets `dayGoal: 1` so any tracked ms fills the square, and `MIN_TRACKED_MS` already keeps
mis-taps out); `--habit-color` → `--activity`; `measure` drives ARIA and interaction (count
→ `aria-pressed`, label `Fri, Aug 1 — completed` / `— not completed, weekly goal met`;
duration → no `aria-pressed` because it opens a form, label `— 1h 20m tracked`); absent
`onDayActivate` renders `<div>`s.

**Keep the "weekly goal met" wording** — the shading says it to a sighted user and without
it a met week reads as four misses. `weekGoal` absent preserves habit-tracker's rule that a
daily activity never shades a column.

Unchanged and load-bearing: `gridAutoFlow: 'column'`, 7 rows, `null` cells for future days,
and the `ResizeObserver` re-pin to `scrollWidth`.

### 2.6 `src/components/ActivityForm.tsx` — one form, in a `Modal`

time-tracker's inline form needed `xl:col-span-full` to survive a grid; habit-tracker
already solved this with the dialog, which is also the scroll container so a tall form on a
short screen produces one scrollbar rather than nesting a second.

1. **Measure** — two-button `fieldset` with `aria-pressed`, **create-only**: `Check off each
   day` / `Time it with a timer`. When editing, a static row: `Check-off activity · can't
   be changed. Archive this and add a new one instead.`
2. **Name** — required, `maxLength={60}`, `autoFocus`. The only field blocking submit.
3. **Description** — optional, `maxLength={120}`.
4. **Icon** — habit-tracker's 12 emoji presets **plus** the free-text `maxLength={2}` field
   with `aria-label="Or type any emoji"`.
5. **Colour** — **habit-tracker's 8 fixed swatches; `<input type="color">` is dropped.**
   Both apps documented the opposite choice; in the merged app habit-tracker's reason is
   stronger, because the home screen is the wall of heat squares the fixed palette exists
   to keep calm. Two follow-ons: give each entry a name (`{ hex: '#6ee7b7', name: 'Mint' }`
   — today `aria-label={option}` announces "#6ee7b7", a real a11y defect), and
   **re-verify the eight pastels against `--color-raised`**, since they were picked to read
   against both `gray-200` and `gray-700` and one constraint is now gone.
6. **Goal** — one `fieldset`, `[amount] per [day|week|month]`, branching only on
   `step`/`min`/suffix: count → `min="1" step="1"`, suffix `times`; duration →
   `inputMode="decimal" min="0" step="0.25"`, suffix `hours`. Empty = no goal, a valid
   activity. Defaults: new count `1 per day`, new duration blank. Helper text ported.

**Measure cannot change after creation.** The reasons are about data, not effort: the two
measures store different records, so count → duration would invent start/end times a
checkbox never had and duration → count would discard every interval; and the goal *unit*
changes meaning, so `3 per week` silently becomes 3 hours. The escape hatch is one tap —
archive (history preserved) and add a new one.

### 2.7 Screen by screen

**`Today.tsx`** — timeline, lane packing, now-line auto-scroll-once, tap-to-edit, chips:
**ported unchanged**, duration-only by construction. A check-off has no interval; drawing
one as an all-day band would occupy a lane for 24 hours and squeeze every real bar. **New
second empty state** for the count-only owner: *The timeline draws timed stretches. None of
your activities are timed — their history is on the Activities grid.* `[Go to Activities]`

**`Log.tsx`** — week stepper, day grouping with the tracked union in sticky headings,
inline edit, `+ Add`, Resume-an-accidental-stop: **ported unchanged**. Keep `groupByDay`'s
comment about building a new structure rather than reversing `entries` — `latestByActivity`
depends on Dexie's oldest-first order. **No check-off rows**: the heat grid already *is*
the count log, it's on the dashboard and in the sheet, it backfills by clicking an older
square, and it shows a year at once; a list would be a second, worse place to look for the
same fact. **`EntryForm`'s activity `<select>` filters to `measure === 'duration'`** — a
completion has no start/end. Same count-only empty state.

**`Insights.tsx`** — panel by panel:

| panel | verdict |
|---|---|
| Scale tabs, `PeriodStepper`, `?activity=`, `Delta` colourlessness | unchanged |
| `Summary`, unfocused `Trend`, `Breakdown` | duration-only by definition; render only when a duration activity exists. `ponytail:` mark the absent count sibling for `Breakdown` — the goals panel covers goal-bearing ones, the grid covers the rest |
| focused `Trend` | **both.** `hours` → `amount`; `tickFormatter` and tooltip branch on measure (`3h` vs `3`). For a count activity the bars are "times per period" — right, and no new chart type |
| `Goals` | **both**, once the goal model is unified. `formatDuration` → `formatAmount`; Meter fill, `Goal met`, `N% there` and the streak caption unchanged |
| `FocusSummary` | **branches.** duration → `Time` + `Share of tracked` + `RunningTimer` pulse, unchanged. count → the `ui/Stat` trio + `Delta`; "share of tracked" is meaningless for a count |
| header `+` (retroactive log) | duration-only — for a count activity the retroactive action is ticking a past day, which lives in the grid |
| **new: `HeatGrid weeks={53}`** on the focused view | **both.** It's what replaces the `+` for a count activity, and "which days did I do any of this" is informative for a duration one |

**`Settings.tsx`** — ported, copy only: "activities and entries" → "activities, entries and
check-offs", import status counts three things. habit-tracker's theme toggle and its own
`Settings.tsx` are dropped.

### 2.8 Styling — `src/index.css`

time-tracker's file **plus** two `@layer base` lines and one `@layer components` block.
Deleted from habit-tracker's: `@custom-variant dark`, the light `html` rule, the
`data-theme` override.

**`--activity` wins over `--habit-color`** — it names a concept the app still has, and two
`@utility` blocks already read it. `HeatGrid` keeps setting it on its own wrapper
(self-contained beats invisible ambient context); it inherits the same value from a running
card's root, a harmless no-op worth one comment.

**The two percentages are different rules and both survive** — the tempting move is to
"unify" them. `activity-tint` is **8%** because *text sits on it*, ceiling set by the
dimmest text against a worst-case white pick. `.heat-square[data-week-met]` is **50%**
because *nothing sits on a square* — below that it sinks into the empty grey, above it the
logged days stop standing out. Both explanations go in the comments.

```css
@layer base {
  /* Nothing here is worth the tap-drag a selection costs on mobile, and the card's
     swipe-to-delete fights the browser's own selection behaviour. */
  body { -webkit-user-select: none; user-select: none; }
  /* …except a field being typed into. Replaces the `select-text` class the old habit form
     repeated on every input. */
  input, textarea { -webkit-user-select: text; user-select: text; }
}

@layer components {
  /* A components block, not an @utility: its behaviour lives in data-attribute variants
     whose *order* matters, which a utility cannot express. */
  .heat-square {
    border-radius: 0.1875rem;
    /* `raised`, not `recess`: a square sits inside a `panel`, and recess is the canvas
       shade — a 13px square that colour is nearly invisible. recess is right for the
       Meter's long track and wrong here. */
    background-color: var(--color-raised);
    transition: background-color 120ms ease-out, transform 120ms ease-out;
  }
  /* MUST stay above [data-done]: same specificity, later rule wins the tie. */
  .heat-square[data-week-met='true'] {
    background-color: color-mix(in oklab, var(--activity) 50%, transparent);
  }
  .heat-square[data-done='true'] { background-color: var(--activity); }

  @media (hover: hover) {   /* on touch this would stick after a tap */
    .heat-square:not([data-done='true']):hover {
      background-color: color-mix(in oklab, var(--activity) 35%, transparent);
    }
    .heat-square[data-done='true']:hover { transform: scale(1.18); }
  }

  .heat-square[data-today='true'] { outline: 2px solid var(--color-ink-muted); outline-offset: 1px; }
  /* After the today outline so it wins. 182 focusable buttons with no visible focus ring
     was the one a11y gap the habit grid shipped with. */
  .heat-square:focus-visible { outline: 2px solid var(--color-accent-ink); outline-offset: 2px; }
}
```

`body { user-select: none }` **stays global with fields re-enabled** — less code than
habit-tracker's per-input `select-text`. Accepted cost: an entry's note on the Log is not
selectable; tapping the row opens a form where it is an input.

**All seven `@utility` blocks survive.** `docked` now serves three things — `UpdatePrompt`,
the discarded-timer toast, and habit-tracker's undo toast, which becomes the same
component; habit-tracker's `fixed inset-x-4 bottom-4 z-20 max-w-sm` is deleted in its
favour. **Nothing from habit-tracker needs a new `@utility`** — the grid's geometry is
inline styles driven by `SQUARE`/`GAP`, which must stay in JS because `weeksThatFit` and
`useFittingWeeks` measure against the same numbers.

One free improvement: habit-tracker's 182 square transitions were never wrapped in
`prefers-reduced-motion`; time-tracker's global reset now covers them.

---

## Part 3 — File manifest

Scaffold from time-tracker (the superset): `package.json` (its deps unchanged —
habit-tracker adds none), `tsconfig*.json`, `.oxlintrc.json`, `index.html`, `public/*`,
`.github/workflows/ci.yml`, `.claude/launch.json`. `vite.config.ts` merges time-tracker's
`registerType: 'prompt'` + woff2 glob + `test: { environment: 'node', env: { TZ:
'America/Los_Angeles' } }` with habit-tracker's `server.port` fallback, and a new manifest
name. Four scripts stay green: `typecheck`, `lint`, `test`, `build`.

| path | source | status |
|---|---|---|
| `src/data/types.ts` | both type files | **rewritten** §1.1 |
| `src/data/db.ts` | tt `data/db.ts` | edited — name, class, third table |
| `src/data/activities.ts` | tt | edited — `measure` + count-target validation |
| `src/data/entries.ts` | tt | **verbatim** |
| `src/data/completions.ts` | — | **new** §1.6 |
| `src/data/prefs.ts` | tt | edited — prefix, two prefs dropped |
| `src/data/transfer.ts` | tt + ht `transfer.ts` | edited — third table §1.7 |
| `src/lib/time.ts` | tt + ht `dates.ts` | edited — absorbs `DateKey` helpers, pins week start, adds `dayWindowsIn` |
| `src/lib/days.ts` | — | **new** §1.4 |
| `src/lib/accounting/goals.ts` | tt + ht `stats.ts` | edited — `streaks` in-progress rule |
| `src/lib/accounting/totals.ts` | tt | **verbatim** |
| `src/lib/heatStrip.ts` | ht | edited — gains `weekGrid` |
| `src/lib/palette.ts` | ht | edited — named swatches, re-verified pastels |
| `src/lib/format.ts` | tt | edited — `+ formatAmount(measure, n)` |
| `src/lib/lanes.ts`, `useNow.ts` | tt | **verbatim** |
| `src/lib/useToday.ts` | ht | **verbatim** — now needed by both measures |
| `src/App.tsx`, `src/main.tsx` | tt | edited — `SCREENS` relabelled, redirect dropped |
| `src/index.css` | tt | edited §2.8 |
| `src/components/ui/{Button,Meter,PeriodStepper,EmptyState}.tsx` | tt | **verbatim** |
| `src/components/ui/Modal.tsx` | ht `Modal.tsx` | edited — tokens, no `dark:` |
| `src/components/ui/Toast.tsx` | `Tracker.tsx:278` + ht `App.tsx:110` | **new** — merges both toasts |
| `src/components/ui/Stat.tsx` | `HabitSheet.tsx:98` | **new** — extracted |
| `src/components/SwipeToDelete.tsx` | `HabitCard.tsx:44-152` | **new** — extracted |
| `src/components/ActivityCard.tsx` | `HabitCard.tsx` + `Tracker.tsx` row | **new** §2.3 |
| `src/components/ActivitySheet.tsx` | ht `HabitSheet.tsx` | edited §2.4 |
| `src/components/ActivityForm.tsx` | ht `HabitForm.tsx` + tt inline form | **new** §2.6 |
| `src/components/HeatGrid.tsx` | ht | edited §2.5 |
| `src/components/EntryForm.tsx` | tt | edited — select filtered to duration |
| `src/components/{entryDraft.ts,ForgottenPrompt.tsx,UpdatePrompt.tsx}` | tt | **verbatim** |
| `src/screens/Activities.tsx` | replaces tt `Tracker.tsx` | **new** §2.2 |
| `src/screens/{Today,Log}.tsx` | tt | edited — count-only empty state |
| `src/screens/Insights.tsx` | tt | edited — measure branches §2.7 |
| `src/screens/Settings.tsx` | tt | edited — copy only |

**Not ported:** ht `data/store.ts` (localStorage store, `mergeStores`, `useHabits`), ht
`lib/stats.ts`, ht `lib/dates.ts` (folded), ht `lib/useTheme.ts`, ht `components/Settings.tsx`,
tt `screens/Placeholder.tsx`, tt `Tracker.tsx`'s `ActivityPanel`, `<input type="color">`,
ht's header gear, tt `planning/`, `PROGRESS.md`, `run-sprints.sh` (a build harness for a
project that is already built).

`useNow` and `useToday` are both mounted on the dashboard and are **not** redundant: one
ticks epoch ms for a running timer, the other renames the day at midnight.

---

## Part 4 — Tests

Config: `environment: 'node'`, `TZ: 'America/Los_Angeles'`, `fake-indexeddb/auto` imported
per Dexie test file, colocated `*.test.ts`. Both suites already do exactly this.

**Port verbatim** (import paths only): `lib/accounting/totals.test.ts`, `lib/lanes.test.ts`,
`lib/format.test.ts`, `lib/heatStrip.test.ts`, `data/entries.test.ts` (the sentinel and
window-anchoring coverage is the most valuable file in either repo).

**Edited:** `data/activities.test.ts` — fixtures gain `measure`, new count-target cases.
`lib/time.test.ts` — absorbs ht `dates.test.ts` case for case (DST, local-vs-UTC), plus one
new case asserting `weekWindow` starts on Sunday.

**Rewritten:** `lib/accounting/goals.test.ts` — keep every case, flip the one that changes
(`does not count the in-progress period as a hit either` → `{ current: 1, longest: 1 }`),
keep the unmet-in-progress assertion, and add a count-shaped case (target 5, totals
`5,5,3,2`) proving one code path scores both measures.

**`habit-tracker/src/lib/stats.test.ts` (227 lines) is deleted as a file and re-homed case
by case — this is the single most important migration task in the plan.** Those lines are
the only written record of the grace rule, the tombstone rule, and the DST behaviour. Each
becomes a `goals.test.ts` case over `ScoredPeriod[]` built by `periodAmounts`, or a
`days.test.ts` case. Must survive: an unlogged today still counts the run through
yesterday; both today and yesterday missed → 0; a `done: false` day breaks the streak; a
streak counts across a DST transition; scattered days give a 2-week weekly streak where a
daily reading gives 1; an in-progress short week does not break the run; an over-achieving
week counts once; longest resets on a missed week.

`habit-tracker/src/data/store.test.ts` — deleted; its `mergeStores` LWW cases move into
`transfer.test.ts` as completion-merge cases through `winner`/`resolve`.

**New — `lib/days.test.ts`, the highest-value new file**, since `days.ts` is the only
genuinely new logic: tombstoned days are not hits; an entry spanning midnight splits across
two keys that sum to its length; an open entry contributes only up to `now`; spring-forward
(23h day) and fall-back (25h day) land on the right keys; a week window sums exactly seven
keys across a transition; `periodAmounts` over a week equals `bucketTotals` over that week
(the equivalence the whole design rests on); `dayMet` for a partial day against a daily
duration target, for a no-target activity, and for a weekly count activity.

**New — `data/completions.test.ts`** (`fake-indexeddb`): toggle on then off leaves **one**
row with `done: false`, not zero rows; `false` comes back out of IndexedDB as `false`; a
second toggle cannot create a second row; `updatedAt` stamped on every write.

**Extended — `data/transfer.test.ts`:** completions round-trip with **`done: false`
surviving JSON both ways** (the highest-value single assertion in the file); non-boolean
`done` rejected; ids recomputed not trusted.

136 → roughly 200 colocated tests.

---

## Part 5 — Build order

1. Copy this file to `activity-tracker/PLAN.md`. `git init`. Scaffold + config + CI, four
   scripts green on an empty `src`.
2. `data/types.ts`, `data/db.ts` — nothing compiles without them.
3. `lib/time.ts` (DateKey helpers on date-fns, pinned week start, `dayWindowsIn`) + its
   tests, including the re-homed `dates.test.ts` cases. The calendar is green before
   anything crosses it.
4. `data/activities.ts`, `data/entries.ts`, `data/completions.ts` + tests.
5. `lib/accounting/totals.ts` verbatim; `goals.ts` with the new `streaks` + flipped tests.
6. **`lib/days.ts` + `lib/days.test.ts` — the keystone. No UI before it is green.**
7. Re-home `stats.test.ts` case by case; delete `stats.ts`.
8. `data/prefs.ts`, `data/transfer.ts` + tests.
9. Mechanical lib ports, own commits: `heatStrip.ts`, `palette.ts`, `format.ts`,
   `lanes.ts`, `useNow.ts`, `useToday.ts`.
10. `index.css` + `ui/` primitives + `Modal`, `Toast`, `Stat`.
11. `HeatGrid`, `SwipeToDelete`, `ActivityCard`, `ActivitySheet`, `ActivityForm`.
12. `App.tsx` + `screens/Activities.tsx`.
13. Port `Today`, `Log`, `Settings`; then `Insights` (the largest edit).

Atomic commits throughout — mechanical ports in their own commits, never mixed with
behaviour changes.

---

## Part 6 — Verification

**Automated:** `npm run typecheck && npm run lint && npm run test && npm run build`, all
green. ~200 tests.

**Manual, in the browser** (`npm run dev`, then a `preview` build to exercise the service
worker):

1. **Contrast probe** — composite every background down the ancestor chain onto a 1×1
   canvas (reading `getComputedStyle().backgroundColor` returns unresolved `oklab(… /
   0.08)` and silently garbage numbers). All five screens to zero AA text failures, plus
   the empty square against `panel` and against a running card's `activity-tint`.
2. **Re-measure the eight pastels** against `--color-raised`.
3. **375px dashboard pass** — 20 cards, mixed measures, one running, one paused, one
   archived, long names. Card strip never scrolls at any card width.
4. **Swipe-to-delete on a duration card with three buttons** — the `onClickCapture` swallow
   must not eat a Stop tap, and a release *over* Stop must delete rather than stop.
5. **The unified goal path** — create a count activity `3 per week` and a duration activity
   `4h per day`. Tick three days; confirm the card reads `3 of 3 this week · 1 week
   streak`, the column shades, and Insights' Goals panel scores both from the same panel.
6. **The streak rule that changed** — tick today on a 4-day streak and confirm the number
   moves to 5 immediately (it did not in time-tracker).
7. **Keyboard** — tab into a heat square, confirm the focus ring beats the `data-today`
   outline; Esc closes sheet and form without desyncing React state.
8. **Midnight rollover with the app open** (`useToday`), and a DST day on both the grid and
   the Today timeline.
9. **Count-only owner** — Today, Log and Insights each show a state that is true and points
   home. No blank screens, no broken panels.
10. **Manual data entry, since there is no importer** — backfill a check-off by clicking a
    past heat square; add a timed entry via Log → `+ Add`. Both must round-trip through
    export/import.

---

## Open items called out, not decided

- **Duration streaks are capped at 26 weeks** by the dashboard's entries read (count
  streaks are unbounded — completions are read whole). Ceiling and upgrade path are marked
  with a `ponytail:` comment.
- **`MAX_COUNT_TARGET.month = 31`** lets "31 days in February" through, which reads as a
  miss every February. Marked; the fix needs the specific month, which a validator lacks.
- **Two destructive-action styles coexist** — activity delete is swipe + 6s undo toast (soft
  delete, no confirm); entry delete is `window.confirm` with no undo. They differ because
  undo exists for one and not the other; the better fix (undo for entries) is out of scope.
  Marked.
