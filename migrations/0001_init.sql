-- The entire server-side schema: one row holding one JSON blob.
--
-- The blob is `src/data/transfer.ts`'s export format, stored opaquely. Conflict resolution
-- happens on the client, where `importJson` already resolves it per record, so the server
-- needs no notion of activities, entries or completions.
CREATE TABLE blob (
  id        INTEGER PRIMARY KEY CHECK (id = 1),  -- one row, enforced by the schema
  json      TEXT    NOT NULL,
  updatedAt INTEGER NOT NULL                     -- server clock; doubles as the blob's version
);
