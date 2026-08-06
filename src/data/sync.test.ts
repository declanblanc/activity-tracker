// Sync is the only module that talks to the network, and its failure modes are quiet ones: a
// merge that silently drops a record, a `done: false` tombstone resurrected into a completed
// day, or a watermark advanced past changes a failed sync never sent. `fetch` is stubbed with a
// server that implements the same one-blob contract as `worker/index.ts`, and the database is a
// real (in-memory) IndexedDB.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db.ts'
import { getPref, setPref } from './prefs.ts'
import { syncNow } from './sync.ts'
import { exportJson } from './transfer.ts'
import {
  NOT_DELETED,
  OPEN_ENTRY_END,
  completionId,
  type Activity,
  type Completion,
  type Entry,
} from './types.ts'

const HOUR = 60 * 60 * 1000
const T0 = Date.UTC(2026, 0, 15, 8)
const TOKEN = 'test-token'

function activity(fields: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1',
    name: 'Work',
    color: '#38bdf8',
    measure: 'duration',
    archived: false,
    sortOrder: 0,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: NOT_DELETED,
    ...fields,
  }
}

function entry(fields: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1',
    activityId: 'activity-1',
    startedAt: T0,
    endedAt: T0 + HOUR,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: NOT_DELETED,
    ...fields,
  }
}

function completion(fields: Partial<Completion> = {}): Completion {
  const activityId = fields.activityId ?? 'habit-1'
  const day = fields.day ?? '2026-01-15'
  return { id: completionId(activityId, day), activityId, day, done: true, updatedAt: T0, ...fields }
}

const clearDatabase = () =>
  Promise.all([db.activities.clear(), db.entries.clear(), db.completions.clear()])

/**
 * A remote blob in the real export format, built by seeding the database, exporting it and
 * wiping it again — so the wire format under test is the one the app actually produces rather
 * than a hand-written fixture that can drift from it.
 */
async function remoteBlob(seed: () => Promise<unknown>): Promise<string> {
  await seed()
  const json = await exportJson()
  await clearDatabase()
  return json
}

type FakeServer = { json: string | null; updatedAt: number; downloads: number; uploads: number }

/**
 * The contract `worker/index.ts` implements: `GET` returns the blob unless `If-None-Match` already
 * names its version, and `PUT` replaces it only while `If-Match` still does.
 *
 * The counters are how a test asserts that an idle sync moved nothing — the whole point of the
 * conditional headers — rather than only that it did no harm. `onUpload` runs just before a write
 * is evaluated, which is where a test puts another device's write to open the race `If-Match` exists
 * to close.
 */
function stubServer(initial: string | null = null, onUpload?: (server: FakeServer) => void): FakeServer {
  const server: FakeServer = {
    json: initial,
    updatedAt: initial === null ? 0 : T0,
    downloads: 0,
    uploads: 0,
  }
  const version = () => `"${server.updatedAt}"`
  let writes = 0

  vi.stubGlobal(
    'fetch',
    vi.fn((_input: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>

      if (init.method === 'GET') {
        if (headers['If-None-Match'] === version()) {
          return Promise.resolve(new Response(null, { status: 304 }))
        }
        server.downloads += 1
        return Promise.resolve(jsonResponse({ json: server.json, updatedAt: server.updatedAt }))
      }

      onUpload?.(server)
      if (headers['If-Match'] !== version()) {
        return Promise.resolve(new Response('stale', { status: 412 }))
      }
      server.uploads += 1
      server.json = init.body as string
      // A distinct version per write, so a stale caller is one the fake can actually recognise.
      writes += 1
      server.updatedAt = T0 + HOUR * writes
      return Promise.resolve(jsonResponse({ updatedAt: server.updatedAt }))
    }),
  )

  return server
}

/** Refuses everything, the way the Worker answers a token it does not recognise. */
function stubUnauthorizedServer(): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('unauthorized', { status: 401 }))))
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

/** `prefs.ts` is the app's only `localStorage` caller, and the node environment has none. */
function stubLocalStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => void store.clear(),
  })
}

describe('syncNow', () => {
  beforeEach(async () => {
    stubLocalStorage()
    setPref('syncToken', TOKEN)
    await clearDatabase()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses to run without a token, rather than calling the server', async () => {
    setPref('syncToken', '')
    const server = stubServer()

    await expect(syncNow()).rejects.toThrow(/sync token/)
    expect(fetch).not.toHaveBeenCalled()
    expect(server.json).toBeNull()
  })

  it('uploads the local database on a first-ever sync', async () => {
    await db.activities.add(activity())
    await db.entries.add(entry())
    const server = stubServer(null)

    const { syncedAt } = await syncNow()

    expect(server.json).toContain('activity-1')
    expect(getPref('lastSyncAt')).toBe(syncedAt)
  })

  it('pulls a remote record into an empty database', async () => {
    const blob = await remoteBlob(() =>
      Promise.all([db.activities.add(activity({ name: 'Reading' })), db.entries.add(entry())]),
    )
    stubServer(blob)

    await syncNow()

    expect((await db.activities.get('activity-1'))?.name).toBe('Reading')
    expect(await db.entries.count()).toBe(1)
  })

  it('lets the newer remote edit win', async () => {
    const blob = await remoteBlob(() =>
      db.activities.add(activity({ name: 'Remote', updatedAt: T0 + HOUR })),
    )
    await db.activities.add(activity({ name: 'Local', updatedAt: T0 }))
    stubServer(blob)

    await syncNow()

    expect((await db.activities.get('activity-1'))?.name).toBe('Remote')
  })

  it('lets the newer local edit win, and uploads it', async () => {
    const blob = await remoteBlob(() =>
      db.activities.add(activity({ name: 'Remote', updatedAt: T0 })),
    )
    await db.activities.add(activity({ name: 'Local', updatedAt: T0 + HOUR }))
    const server = stubServer(blob)

    await syncNow()

    expect((await db.activities.get('activity-1'))?.name).toBe('Local')
    // The upload has to carry the merge, not just this device's own changes.
    expect(server.json).toContain('Local')
  })

  // `done: false` is a real stored value — the record that a day was deliberately cleared —
  // and the easiest thing in the app to accidentally coerce back into a completed day.
  it('keeps a cleared day cleared when it arrives as the newer edit', async () => {
    const blob = await remoteBlob(() =>
      db.completions.add(completion({ done: false, updatedAt: T0 + HOUR })),
    )
    await db.completions.add(completion({ done: true, updatedAt: T0 }))
    stubServer(blob)

    await syncNow()

    const row = await db.completions.get(completionId('habit-1', '2026-01-15'))
    expect(row?.done).toBe(false)
  })

  // Two devices each started the same timer offline. Refusing the merge would wedge sync
  // permanently, because the same pair arrives on every later attempt.
  it('resolves two open timers for one activity instead of failing', async () => {
    const blob = await remoteBlob(() =>
      db.entries.add(entry({ id: 'remote-open', startedAt: T0 + HOUR, endedAt: OPEN_ENTRY_END })),
    )
    await db.entries.add(entry({ id: 'local-open', startedAt: T0, endedAt: OPEN_ENTRY_END }))
    stubServer(blob)

    await syncNow()

    expect((await db.entries.get('local-open'))?.endedAt).toBe(T0 + HOUR)
    expect((await db.entries.get('remote-open'))?.endedAt).toBe(OPEN_ENTRY_END)
  })

  // The whole reason syncing every few seconds is affordable: once both sides agree, a sync
  // transfers no database in either direction. Without this the poll would download and re-upload
  // the entire account every few seconds.
  it('moves nothing once both sides agree', async () => {
    await db.activities.add(activity())
    const server = stubServer(null)

    await syncNow()
    expect(server.uploads).toBe(1)

    await syncNow()
    await syncNow()

    expect(server.downloads).toBe(0)
    expect(server.uploads).toBe(1)
  })

  it('uploads a local edit made after the last sync', async () => {
    await db.activities.add(activity({ name: 'Before' }))
    const server = stubServer(null)
    await syncNow()

    await db.activities.put(activity({ name: 'After', updatedAt: T0 + HOUR }))
    await syncNow()

    expect(server.json).toContain('After')
    expect(server.uploads).toBe(2)
  })

  // The race the old unconditional upload lost silently: both devices merge the same blob, and the
  // second one to write used to drop whatever the first had just added. `If-Match` refuses that
  // write, and the retry merges the winner in first.
  it('merges again rather than overwriting a blob another device wrote first', async () => {
    const theirs = await remoteBlob(() =>
      db.entries.add(entry({ id: 'theirs', updatedAt: T0 + HOUR })),
    )
    await db.entries.add(entry({ id: 'mine', updatedAt: T0 + HOUR }))

    // The other device lands its write once, in the window between this device's download and its
    // upload — so the first upload is refused and the retry is what has to get it right.
    let raced = false
    const server = stubServer(null, (state) => {
      if (raced) return
      raced = true
      state.json = theirs
      state.updatedAt = T0 + 2 * HOUR
    })

    await syncNow()

    // Neither entry was lost: the refused upload was rebuilt on top of theirs.
    expect(server.json).toContain('theirs')
    expect(server.json).toContain('mine')
    expect(await db.entries.count()).toBe(2)
  })

  it('leaves the database and the watermark untouched when the token is refused', async () => {
    await db.activities.add(activity({ name: 'Local' }))
    stubUnauthorizedServer()

    await expect(syncNow()).rejects.toThrow(/refused/)

    expect((await db.activities.get('activity-1'))?.name).toBe('Local')
    // Never advanced on failure, so the next attempt covers the same ground.
    expect(getPref('lastSyncAt')).toBe(0)
  })
})
