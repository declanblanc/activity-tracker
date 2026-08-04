# Deploy Activity Tracker with cloud sync

## Context

The app is a finished local-first PWA with no server and no secrets. Three things are missing:

1. **It isn't deployed.** There's no git remote at all, and CI is checks-only.
2. **The data lives in one browser.** It should also live on a server, so it survives a cleared
   cache and reaches a second device.
3. **Nothing guards the server**, once one exists.

**The target: one Cloudflare Worker serving both the static SPA and a two-route sync API, storing
the whole database as a single JSON blob in D1, guarded by one shared secret.** Free tier
throughout, and one deployment.

### Why a blob and not a table

`transfer.ts` already exports `exportJson`, `importJson`, and `winner()` — a tested, deterministic
last-write-wins resolver whose doc comment reads *"Import is its first caller; sync would be its
second."* So sync is: **download the server's blob, import it, upload the merged result.**
Per-record conflict resolution is code that already exists and already has tests.

A per-record table with watermarks would be more correct under two devices editing the same record
in the same second, which is not a situation one person gets into. It would also store each record
as opaque JSON, so it buys nothing for future analysis — whereas the blob *is* the export file, and
can be `curl`ed straight into DuckDB.

### What this deliberately keeps

The local database stays the thing the UI reads. Every screen uses `useLiveQuery` over Dexie, so
making the server the source of truth would mean rewriting all of `src/data/` and the reactive
pattern the UI is built on — and the app would stop opening offline. The server is a durable copy
and a courier between devices, which is what the two remaining goals actually need.

### Free-tier headroom (single user)

| Resource | Free limit | Expected use |
|---|---|---|
| Static asset requests | unlimited, unmetered | all page loads |
| Worker requests | 100,000/day | ~100/day |
| D1 rows read/written | millions/day | 1 row per sync |
| D1 storage | 5 GB | single-digit MB after years |

---

## Phase 1 — Get it deployed

**No custom domain needed.** The API is guarded by a bearer token, so `*.workers.dev` is as
protected as a custom domain would be — which means nothing blocks on DNS. The app installs as a
PWA from `workers.dev` fine, and `start_url: '/'` already works at a subdomain root, so Vite's
`base` and `BrowserRouter` stay untouched. Move the domain to Cloudflare later if the URL ever
bothers you; it's a config line and no code change.

**`wrangler.jsonc`** (new, repo root):

```jsonc
{
  "name": "activity-tracker",
  "main": "worker/index.ts",
  "compatibility_date": "2026-08-03",
  "assets": {
    "directory": "./dist",
    // BrowserRouter deep links (/insights, /activities) must serve the shell, not a 404.
    "not_found_handling": "single-page-application",
    // Without this, the SPA fallback above would swallow /api/* and return index.html.
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "activity-tracker", "database_id": "<from wrangler>" }
  ]
}
```

**`package.json`** — add `wrangler` as a devDependency so the local CLI and CI's are the same
version. **`.gitignore`** — add `.wrangler/`.

Verify: `npm run build && npx wrangler deploy` — the build must run first or `./dist` won't exist.

---

## Phase 2 — The server

**`migrations/0001_init.sql`** (new) — one row, forever:

```sql
CREATE TABLE blob (
  id        INTEGER PRIMARY KEY CHECK (id = 1),  -- one row, enforced by the schema
  json      TEXT    NOT NULL,
  updatedAt INTEGER NOT NULL                     -- server clock, for the "last synced" display
);
```

**`worker/index.ts`** (new) — two routes and an auth check, and that's the whole server:

- `GET /api/data` → `{ json, updatedAt }`, or `{ json: null }` before the first upload.
- `PUT /api/data` → store the body, stamp `updatedAt`, return it.
- Both reject unless `Authorization: Bearer <token>` matches the `SYNC_TOKEN` secret. Wrong or
  missing token is a plain `401` — no redirect, ever, so an offline client never has to reason
  about a login flow it can't complete.

The server never parses the JSON. Adding a field to a type needs no server change and no migration.

---

## Phase 3 — Client sync

**`src/data/sync.ts`** (new) — the only module in the app that touches the network. Nothing outside
`src/data/` changes, which is the encapsulation `CLAUDE.md` already promises.

`syncNow()`:

1. `GET /api/data` with the stored token.
2. If a blob came back, `await importJson(blob)` — existing per-record `winner()` resolution, so a
   soft-deleted record propagates as a tombstone with a newer `updatedAt` and correctly wins.
3. `PUT /api/data` with `await exportJson()` of the merged local database.
4. `setPref('lastSyncAt', updatedAt)` on success, for display only — the algorithm needs no
   watermark, which is the main thing this design deletes.

**The one race, and why it's self-healing.** Two devices syncing at the same instant both read the
old blob, both merge, and the second `PUT` wins — so the first device's newest records are missing
from the server until its next sync re-uploads them, because it still has them locally. Nothing is
permanently lost unless a device is destroyed inside that window. Worth a `ponytail:` comment
naming the ceiling: a compare-and-swap on `updatedAt` with a retry, if it ever matters.

**One real change to existing code.** `importJson` currently *rejects the whole batch* when two
entries are open for the same activity ([transfer.ts:224](src/data/transfer.ts:224)). Two devices
can each start the same timer offline, so for sync that would wedge permanently — every subsequent
sync throws on the same input. Change `assertOneOpenEntryPerActivity` to
`resolveDuplicateOpenEntries`: keep the entry with the greatest `startedAt` open, soft-delete the
others. One behaviour for both callers rather than a flag — resolving is strictly more forgiving
than rejecting and equally correct for a hand-edited file. `transfer.test.ts` needs updating.

**Triggering** — `src/components/SyncAgent.tsx` (new), mounted alongside `UpdatePrompt`: sync on
mount, on `visibilitychange` → visible, and every 60s while visible. An interval decouples sync
from mutations entirely, so no call site has to remember to trigger it. Failures are silent — this
is an offline-first app, and a failed sync is the normal state on a train.

**Other edits:**

- `src/data/prefs.ts` — add `syncToken: string` and `lastSyncAt: number`. Both genuinely belong
  under that module's "device-local and never synced" doc comment: a per-device credential is the
  one thing that must not travel in the blob.
- `src/screens/Settings.tsx` — a field to paste the token into, the last-synced time, and a "Sync
  now" button. No sign-in flow, because there's nothing to sign in to.
- `CLAUDE.md` / `README.md` — the app is no longer server-free. Document that the server holds an
  opaque blob, that the token is device-local, and the duplicate-open-entry resolution.

**Tests** — `src/data/sync.test.ts`, matching the existing colocated Vitest pattern with
`fake-indexeddb` and a stubbed `fetch`: a round trip merging both directions, a `done: false`
tombstone surviving it, the duplicate-open-entry resolution, and a `401` leaving the local database
untouched.

No `vite.config.ts` change is needed. Workbox's navigation fallback only intercepts navigations, and
both routes are `fetch` calls — there's no login page to navigate to, which was the only thing that
would have collided with the service worker.

---

## Phase 4 — CI/CD

Add a `deploy` job to the existing [`.github/workflows/ci.yml`](.github/workflows/ci.yml), leaving
the `checks` job untouched:

```yaml
  deploy:
    needs: checks
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          preCommands: npx wrangler d1 migrations apply activity-tracker --remote
```

Also add a top-level `concurrency` group so overlapping pushes can't race two deploys. `needs:
checks` means a red typecheck, lint, test, or build blocks the deploy — the four scripts stay the
gate they already are.

---

## Manual steps

**Yours — needs a browser or a credential I shouldn't handle:**

1. **A Cloudflare account**, if you don't have one. Free tier.
2. **`npx wrangler login`** — opens a browser for OAuth. Once done I can run the CLI parts,
   including creating the D1 database and the first deploy.
3. **Generate the sync token and set it as a Worker secret.** Don't paste it into this chat.
   ```bash
   openssl rand -base64 32 | npx wrangler secret put SYNC_TOKEN
   ```
   Print it once with `openssl rand -base64 32` and save it in your password manager first — you
   need the same value in Settings on each device, and the secret store won't show it to you again.
4. **A scoped API token** (Workers Scripts: Edit, D1: Edit) and **two GitHub repo secrets**,
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Dashboard → My Profile → API Tokens, then
   the repo's Settings → Secrets.

**Yours only for a permission — say the word and I'll run them:**

5. `gh auth switch --user declanblanc` — the CLI is on `dblanchard-patreon`; this is personal.
6. **Commit the in-flight work first.** The tree has modified files plus an untracked
   `src/components/EntrySheet.tsx` from the activity-sheet work — unrelated to deployment, and it
   should land as its own commit before any of this.
7. `gh repo create declanblanc/activity-tracker --public --source=. --push` — creating a public
   repo is outward-facing, so I'll confirm before running it.

---

## Verification

1. `npm run typecheck && npm run lint && npm test && npm run build` — the four scripts, still green.
2. `npx wrangler dev` locally: the SPA serves, deep links resolve, and `/api/data` hits the Worker
   rather than the SPA fallback.
3. **Auth**: `curl` the deployed `/api/data` with no header — expect `401`, not data.
4. Push to main; confirm the Actions run goes checks → deploy and the site updates.
5. **Sync**: tick an activity on your phone, open the laptop, confirm it appears. Then go offline on
   one device, edit the *same* activity on both, reconnect — confirm the later edit wins on both.
6. **Durability**: clear site data in one browser, reload, paste the token, sync — everything comes
   back from the server. This is the goal that made a server necessary in the first place.
7. **Offline still works**: airplane mode, cold-launch the installed PWA, confirm every screen
   renders from the precached shell and sync resumes silently on reconnect.

---

## Skipped, and when to add it

- **No custom domain.** Add the DNS move whenever the URL bothers you; it's a `routes` entry and no
  code change.
- **No compare-and-swap on upload.** See the race above — it self-heals for one person.
- **No delta sync.** The whole database moves each sync, which is a few hundred KB. Revisit if that
  ever reaches megabytes.
- **No conflict UI.** LWW resolves silently. Add a prompt only if you find a merge you disagree with.
- **No staging environment.** One user, one branch, and a red `checks` job already blocks a bad
  deploy.
