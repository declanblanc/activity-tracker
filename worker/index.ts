/**
 * The whole server: two routes over one JSON blob, behind one shared secret.
 *
 * The blob is `src/data/transfer.ts`'s export format and this file never inspects it beyond
 * checking that it parses, so adding a field to a type needs no change here and no migration.
 * Conflict resolution is the client's job — `importJson` already resolves it per record — which
 * is why there is no schema, no watermark and no per-record table.
 *
 * The blob's `updatedAt` doubles as its version, and both routes are conditional on it, using the
 * HTTP headers that already mean this rather than a scheme of their own:
 *
 * - `GET` with `If-None-Match` answers `304` when the caller already holds the current blob. That
 *   is what lets a client poll every few seconds without downloading the database each time.
 * - `PUT` with `If-Match` writes only if the blob is still the version the caller merged from, and
 *   answers `412` otherwise. Two devices uploading at once used to mean the second silently
 *   dropped the first one's newest records; now the second is told to merge again and retry.
 */

import type { D1Database } from '@cloudflare/workers-types'

type Env = {
  DB: D1Database
  SYNC_TOKEN: string
}

type StoredBlob = { json: string; updatedAt: number }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Checked before routing, so an unauthenticated caller cannot even learn which paths exist.
    if (!isAuthorized(request, env)) {
      // A plain 401, never a redirect: an offline client cannot complete a login flow, and all
      // it needs to know is that its token was refused.
      return new Response('unauthorized', { status: 401 })
    }

    if (new URL(request.url).pathname !== '/api/data') {
      return new Response('not found', { status: 404 })
    }

    switch (request.method) {
      case 'GET':
        return await readBlob(env, request.headers.get('If-None-Match'))
      case 'PUT':
        return await writeBlob(env, await request.text(), request.headers.get('If-Match'))
      default:
        return new Response('method not allowed', { status: 405 })
    }
  },
}

function isAuthorized(request: Request, env: Env): boolean {
  // Refuse everything until the secret is set, rather than comparing against the string
  // "Bearer undefined" — which is otherwise a valid password between deploy and `secret put`.
  if (!env.SYNC_TOKEN) return false

  const presented = request.headers.get('Authorization')
  const expected = `Bearer ${env.SYNC_TOKEN}`

  // `timingSafeEqual` throws on differing lengths, so that comparison has to come first. It
  // leaks only the token's length, which is fixed and public knowledge anyway.
  if (presented === null || presented.length !== expected.length) return false

  const encoder = new TextEncoder()
  return crypto.subtle.timingSafeEqual(encoder.encode(presented), encoder.encode(expected))
}

async function readBlob(env: Env, ifNoneMatch: string | null): Promise<Response> {
  const row = await env.DB.prepare('SELECT json, updatedAt FROM blob WHERE id = 1').first<StoredBlob>()

  // No row means nothing has ever synced, which is not an error: the client reads `null` as
  // "nothing to merge" and uploads its local database as the first blob. Version 0 covers that
  // case too — a client already holding "nothing" is up to date with an empty server.
  const { json, updatedAt } = row ?? { json: null, updatedAt: 0 }

  // The whole point of the poll being cheap: no body, and no `json` column read on the way out.
  if (ifNoneMatch === etag(updatedAt)) {
    return new Response(null, { status: 304, headers: versionHeaders(updatedAt) })
  }

  return Response.json({ json, updatedAt }, { headers: versionHeaders(updatedAt) })
}

async function writeBlob(env: Env, body: string, ifMatch: string | null): Promise<Response> {
  try {
    JSON.parse(body)
  } catch {
    // Well-formedness only — the shape stays the client's business. Storing a truncated upload
    // would break the next sync on every device, which is far worse than refusing this one.
    return new Response('body must be JSON', { status: 400 })
  }

  const updatedAt = Date.now()

  // Compare-and-swap, in one statement so nothing can slip between the check and the write. The
  // caller merged some version of the blob into what it is now uploading; if that is no longer the
  // stored version, another device has written records this body does not contain and overwriting
  // would lose them.
  const replaced = await env.DB.prepare('UPDATE blob SET json = ?, updatedAt = ? WHERE id = 1 AND updatedAt = ?')
    .bind(body, updatedAt, expectedVersion(ifMatch))
    .run()
  if (replaced.meta.changes === 1) return written(updatedAt)

  // Nothing was replaced, which is either a stale caller or the first-ever write. Only a caller
  // claiming the empty server may create the row, and `OR IGNORE` settles the race between two
  // devices doing that at once — the loser is told it was beaten, the same as any other stale write.
  if (expectedVersion(ifMatch) === 0) {
    const created = await env.DB.prepare('INSERT OR IGNORE INTO blob (id, json, updatedAt) VALUES (1, ?, ?)')
      .bind(body, updatedAt)
      .run()
    if (created.meta.changes === 1) return written(updatedAt)
  }

  return new Response('blob has moved on; merge again and retry', { status: 412 })
}

const written = (updatedAt: number) =>
  Response.json({ updatedAt }, { headers: versionHeaders(updatedAt) })

/** A blob version as an HTTP entity tag. */
const etag = (updatedAt: number) => `"${updatedAt}"`

/**
 * The version an `If-Match` names, or 0 for a caller that has merged nothing — which is also what
 * an absent or unparseable header means, so a client that sends neither can still make the
 * first-ever write and can never accidentally match a real version.
 */
function expectedVersion(ifMatch: string | null): number {
  const version = Number(ifMatch?.replaceAll('"', ''))
  return Number.isSafeInteger(version) && version > 0 ? version : 0
}

/** Never cached: the blob is authenticated, and its conditional requests are the client's to make. */
const versionHeaders = (updatedAt: number) => ({
  ETag: etag(updatedAt),
  'Cache-Control': 'no-store',
})
