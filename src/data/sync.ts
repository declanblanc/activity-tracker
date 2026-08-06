/**
 * Cloud sync: the only module in the app that touches the network.
 *
 * The whole database travels as one JSON blob in `transfer.ts`'s export format, because
 * `importJson` already merges per record with `winner()`. Download, merge, upload — so there is
 * no watermark to keep, and the server stores the blob opaquely, which means adding a field to a
 * type needs no server change and no migration.
 *
 * The local database stays the thing every screen reads. The server is a durable copy and a
 * courier between devices, not the source of truth, which is what keeps the app working offline.
 *
 * **Both halves are conditional, and that is what makes syncing every few seconds affordable.**
 * The blob has a version — the server's `updatedAt` — and this device remembers the one it merged.
 * The download sends it as `If-None-Match`, so a poll that finds nothing new answers `304` and
 * moves no database at all; the upload sends it as `If-Match`, so a merge built on a blob another
 * device has since replaced is refused instead of overwriting it. Idle devices trade a few hundred
 * bytes per poll, and a real change still costs the one full round trip it always did.
 *
 * ponytail: the entire database moves on every sync that has something to move. At one owner's
 * volume that is a few hundred kilobytes; if it ever reaches megabytes, push only records with
 * `updatedAt` above a stored watermark and have the server merge per record instead.
 *
 * ponytail: the other device learns of a change on its next poll, so "immediately" is really "at
 * most one interval". A Durable Object holding a WebSocket per device could push the nudge instead
 * and drop the interval entirely; it is a server rewrite, and a few seconds is not worth one.
 */

import { latestLocalChange } from './db.ts'
import { getPref, setPref } from './prefs.ts'
import { exportJson, importJson } from './transfer.ts'

const ENDPOINT = '/api/data'

/**
 * How many times one `syncNow` will rebuild its merge after another device wrote first.
 *
 * Two, because losing twice in a row needs a third device writing inside the same round trip.
 */
const ATTEMPTS = 2

export type SyncOutcome = { syncedAt: number }

/** One call to the sync endpoint, as this module makes them. */
type Call = { method: 'GET' | 'PUT'; headers: Record<string, string>; body?: string }

/** Merge this device with the server, in both directions, and return when the server holds the result. */
export async function syncNow(): Promise<SyncOutcome> {
  const token = getPref('syncToken')
  if (!token) throw new Error('Add your sync token below to turn syncing on.')

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const outcome = await exchange(token)
    if (outcome) {
      // Only on success, so a failed sync leaves the display honest rather than claiming a sync
      // that did not happen.
      setPref('lastSyncAt', outcome.syncedAt)
      return outcome
    }
  }

  throw new Error('Another device wrote while this one was syncing. It will try again shortly.')
}

/**
 * One download-merge-upload pass, or `null` when the blob moved between the download and the
 * upload — which leaves this merge built on a version the server no longer holds, so it has to be
 * rebuilt on top of the new one rather than replace it.
 */
async function exchange(token: string): Promise<SyncOutcome | null> {
  const remote = await download(token, getPref('mergedServerVersion'))

  if (remote) {
    // Merge before uploading, so what goes up carries both sides rather than this device's view
    // alone. `null` is a first-ever sync, where there is nothing to merge.
    if (remote.json !== null) await importJson(remote.json)
    setPref('mergedServerVersion', remote.version)
  }

  // Read after the merge, not before: the merge can write records of its own — a duplicate open
  // timer closed by `resolveDuplicateOpenEntries` — and those exist on no other device yet.
  //
  // It also means a device that just received a change reads it as newer than anything it has
  // uploaded, and echoes the merged blob straight back once. That upload is not wasted: it is what
  // carries records the sending device never had. It does not repeat, because the sender's own
  // merge of the echo adds nothing it has not already sent.
  const local = await latestLocalChange()
  if (local > getPref('uploadedLocalChange')) {
    const version = await upload(token, await exportJson(), getPref('mergedServerVersion'))
    if (version === null) return null
    setPref('mergedServerVersion', version)
    setPref('uploadedLocalChange', local)
  }

  return { syncedAt: Date.now() }
}

/** The server's blob, or `null` when this device has already merged the current one. */
async function download(
  token: string,
  merged: number,
): Promise<{ json: string | null; version: number } | null> {
  const response = await request(token, {
    method: 'GET',
    headers: { 'If-None-Match': etag(merged) },
  })
  if (response.status === 304) return null

  const body = (await response.json()) as { json: string | null; updatedAt: number }
  return { json: body.json, version: body.updatedAt }
}

/** The blob's new version, or `null` when another device wrote first and this merge is stale. */
async function upload(token: string, blob: string, merged: number): Promise<number | null> {
  const response = await request(token, {
    method: 'PUT',
    headers: { 'If-Match': etag(merged), 'Content-Type': 'application/json' },
    body: blob,
  })
  if (response.status === 412) return null

  const body = (await response.json()) as { updatedAt: number }
  return body.updatedAt
}

/** A blob version as an HTTP entity tag. `0` is "this device has merged nothing yet". */
const etag = (version: number) => `"${version}"`

/**
 * Every failure throws an `Error` whose `message` is written for the owner, the same
 * trust-boundary contract the rest of `data/` follows.
 */
async function request(token: string, call: Call): Promise<Response> {
  const response = await fetch(ENDPOINT, {
    ...call,
    // The conditional headers above are managed here, so the browser's own cache must not answer
    // or rewrite them — and an authenticated blob has no business in a cache anyway.
    cache: 'no-store',
    headers: { ...call.headers, Authorization: `Bearer ${token}` },
  })

  if (response.status === 401) {
    throw new Error('The server refused that sync token. Check it matches your other devices.')
  }
  // `304` and `412` are answers rather than failures — "nothing new" and "you were beaten to it" —
  // and both callers above act on them.
  if (!response.ok && response.status !== 304 && response.status !== 412) {
    throw new Error(`Sync failed with status ${response.status}.`)
  }

  return response
}
