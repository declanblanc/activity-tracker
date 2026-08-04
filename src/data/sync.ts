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
 * ponytail: the entire database moves on every sync. At one owner's volume that is a few hundred
 * kilobytes; if it ever reaches megabytes, push only records with `updatedAt` above a stored
 * watermark and have the server merge per record instead.
 */

import { getPref, setPref } from './prefs.ts'
import { exportJson, importJson } from './transfer.ts'

const ENDPOINT = '/api/data'

export type SyncOutcome = { syncedAt: number }

/**
 * Merge this device with the server, in both directions, and return when the server holds the
 * result.
 *
 * ponytail: two devices syncing in the same instant both read the pre-merge blob, and the second
 * upload wins — so the first device's newest records are missing from the server until its next
 * sync re-uploads them from its own database. Nothing is lost unless that device dies inside the
 * window. A compare-and-swap on the blob's `updatedAt` plus a retry closes it, if it ever matters.
 */
export async function syncNow(): Promise<SyncOutcome> {
  const token = getPref('syncToken')
  if (!token) throw new Error('Add your sync token below to turn syncing on.')

  const { json } = await send<{ json: string | null }>(token, 'GET')

  // Merge before uploading, so what goes up carries both sides rather than this device's view
  // alone. `null` is a first-ever sync, where there is nothing to merge.
  if (json !== null) await importJson(json)

  const { updatedAt } = await send<{ updatedAt: number }>(token, 'PUT', await exportJson())

  // Only on success, so a failed sync leaves the display honest rather than claiming a sync that
  // did not happen.
  setPref('lastSyncAt', updatedAt)
  return { syncedAt: updatedAt }
}

/**
 * Every failure throws an `Error` whose `message` is written for the owner, the same
 * trust-boundary contract the rest of `data/` follows.
 */
async function send<T>(token: string, method: 'GET' | 'PUT', body?: string): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  })

  if (response.status === 401) {
    throw new Error('The server refused that sync token. Check it matches your other devices.')
  }
  if (!response.ok) throw new Error(`Sync failed with status ${response.status}.`)

  return (await response.json()) as T
}
