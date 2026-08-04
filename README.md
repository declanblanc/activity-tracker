# Activity Tracker

Two kinds of thing in one app.

Some things you just **check off**: stretched today, took the pills, wrote something. One tap a
day, and what you want to see is a wall of filled squares and a streak.

Other things you want the **hours** for: deep work, sleep, a fast. You flip a timer on and off,
possibly several at once, and what you want to see is where the day went.

This tracks both, side by side, on one screen. No account and no subscription — it is an
installable PWA that reads and writes a local database, so every screen works with no network.

There is a server, but only as a courier. Optional cloud sync keeps a copy of the database on a
Cloudflare Worker so it survives a cleared cache and reaches a second device; paste one shared
token into Settings on each device to turn it on. The local database stays the source every screen
reads. See [DEPLOY.md](DEPLOY.md).

## Running it

```bash
npm install
npm run dev
```

Four scripts, all expected to stay green: `typecheck`, `lint`, `test`, `build`.

`npm run preview` builds and serves for real, which is the only way to exercise the service
worker and the update prompt.

## How it is built

Vite + React + TypeScript + Tailwind v4, Dexie over IndexedDB, date-fns for calendars, Recharts
for the one chart, lucide for icons. Installable and fully offline — every screen works with no
network, because all the data is local.

## The one idea worth knowing

An activity has a **measure**, and it is the only field that changes what the app does with it:

- `count` — checked off once per local day, stored as `Completion` rows.
- `duration` — runs a timer, stored as `Entry` intervals.

Everything else is shared: icon, colour, goal, archive, order, soft delete, the streak, the goals
panel.

That sharing is the whole point, and it works because of one function. `dayAmounts` in
[src/lib/days.ts](src/lib/days.ts) reduces either measure to **one number per local day** — `1`
for a logged day, or milliseconds tracked within that day. It is the only place `measure` is
branched on. Past it, `periodAmounts` folds days into weeks and months and `streaks` scores them,
neither knowing nor caring which kind of activity it is looking at.

So "3 days of 5 this week" and "2h 45m of 4h today" go through exactly the same code.

What is *not* shared is how history gets drawn, and deliberately so. A check-off activity gets the
contribution grid, which answers "on which days did this happen". A timed one gets a list of its
stretches, the Today timeline and the Insights trend, all of which can show *how much* — a square
that is merely on or off would make twenty minutes and six hours look identical.

## The four screens

- **Activities** — every activity as a card. Check-offs carry a tick and a grid; timers carry
  start/pause/stop and a live reading. Tapping a card's name opens its **sheet**, which is where
  that activity's history, streaks, goal, and its recorded stretches live.
- **Today** — one day as a vertical timeline, overlapping timers packed into lanes, drawn to fit the
  screen so the shape of the day needs no scrolling. Tap a bar to correct it; tap empty space before
  now to write down a stretch that started there.
- **Insights** — day/week/month coverage, a trend chart, and the goals panel that scores both
  measures.
- **Settings** — export, import, update check.

There is no separate log screen: a timed activity's stretches are listed in its own sheet, newest
first, and each row opens the form that corrects it. The trade-off is that there is no one place
showing every activity's stretches for an arbitrary past day — Today does it for today, and
Insights' breakdown gives per-activity totals for a period.

## Where the data lives

IndexedDB, on this device only. **Clearing site data erases your history.**

Settings → Export writes a JSON file with everything in it, tombstones included. Import merges
rather than overwrites: last write wins per record, so re-importing a stale backup cannot roll
back a day you logged after it was taken. There is also a CSV export for a spreadsheet, which
cannot be imported back, and says so.

## Five details that look like details but are not

**Days are named by local calendar parts, never `toISOString()`.** Logging something at 6pm
Tuesday in California would otherwise fill in Wednesday's square.

**Day arithmetic steps the date field, never `± 86_400_000`.** DST would skip or repeat a day
twice a year, silently corrupting every streak. Both of these are covered by
[src/lib/time.test.ts](src/lib/time.test.ts), pinned to `America/Los_Angeles`.

**The week starts on `WEEK_STARTS_ON`, one shared constant.** A heat column and the week the
goals panel scores must be the same seven days; date-fns's default would move one of them if a
locale were ever configured.

**A cleared day is stored as `done: false`, not as a deleted row.** The row records that a
decision was made; only `done` says which way. Delete it and "I cleared this day" becomes
indistinguishable from "I never touched it", so a stale import would bring it back.

**Two numbers that are not meant to agree.** A per-activity total sums that activity's own
intervals, so overlapping timers each count in full. Tracked wall-clock is the *union* across
every activity, counting shared time once. The second is what makes "untracked" mean anything;
reconciling them would break both.

## Streaks

A streak counts periods at the goal's own period — days for a daily goal, weeks for a weekly
one. A period still in progress is **skipped rather than counted as a miss**, so the number does
not read zero every morning until you get round to the day. But a period that has *already* met
its goal counts immediately: ticking the last box is exactly when the number should move.
