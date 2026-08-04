/**
 * Settings.
 *
 * The Data section is the only way data leaves or enters the device: a JSON backup
 * that round-trips exactly, a CSV for a spreadsheet, and an import that either applies
 * whole or not at all. Everything it calls lives in `data/transfer.ts` — this screen
 * knows nothing about sentinels, formats or transactions.
 */
import { useRef, useState } from 'react'
import Button from '../components/ui/Button.tsx'
import { deleteAllData } from '../data/db.ts'
import { getPref, setPref } from '../data/prefs.ts'
import { syncNow } from '../data/sync.ts'
import { exportCsv, exportJson, importJson } from '../data/transfer.ts'
import { toDateTimeInput } from '../lib/time.ts'

/**
 * One status line at a time, tagged with the section that produced it. Without `section` a sync
 * failure reports itself under the Data buttons, which is where the reader is not looking.
 */
type Section = 'data' | 'app' | 'sync' | 'delete'
type Status = { tone: 'ok' | 'error'; message: string; section: Section } | null

/** The word the owner must type before the wipe is allowed to fire. */
const DELETE_CONFIRMATION = 'confirm'

export default function Settings() {
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [token, setToken] = useState(() => getPref('syncToken'))
  // Held in state rather than read on each render, so a sync started here updates the line
  // beneath it. `SyncAgent`'s background runs are not reflected until the screen is reopened,
  // which is the whole cost of not putting a device setting into Dexie.
  const [lastSyncAt, setLastSyncAt] = useState(() => getPref('lastSyncAt'))
  // The delete gate is two steps: an initial button reveals the text input, and the wipe only
  // fires once the owner has typed the confirmation word into it.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const deleteConfirmed = deleteConfirmation.trim().toLowerCase() === DELETE_CONFIRMATION

  /** Every button here can fail on a full disk or a bad file; none may leave the screen stuck. */
  async function run(section: Section, job: () => Promise<string>) {
    setBusy(true)
    setStatus(null)
    try {
      setStatus({ tone: 'ok', message: await job(), section })
    } catch (error) {
      setStatus({ tone: 'error', message: (error as Error).message, section })
    } finally {
      setBusy(false)
    }
  }

  const exportFile = (extension: 'json' | 'csv', type: string, build: () => Promise<string>) =>
    run('data', async () => {
      const name = `activity-tracker-${toDateTimeInput(Date.now()).slice(0, 10)}.${extension}`
      download(name, await build(), type)
      return `Saved ${name}.`
    })

  const saveToken = () =>
    void run('sync', async () => {
      setPref('syncToken', token.trim())
      setToken(token.trim())
      return token.trim().length === 0 ? 'Sync turned off on this device.' : 'Sync token saved.'
    })

  /** Saves first, so "Sync now" works on a token that was typed but not yet saved. */
  async function syncAndReport(): Promise<string> {
    setPref('syncToken', token.trim())
    const { syncedAt } = await syncNow()
    setLastSyncAt(syncedAt)
    return 'Synced.'
  }

  async function importFile(file: File) {
    await run('data', async () => {
      const { activities, entries, completions } = await importJson(await file.text())
      return (
        `Imported ${activities} ${plural(activities, 'activity', 'activities')}, ` +
        `${entries} ${plural(entries, 'entry', 'entries')} and ` +
        `${completions} ${plural(completions, 'check-off', 'check-offs')}.`
      )
    })
    // Clear the input so re-picking the same file fires `change` again.
    if (fileInput.current) fileInput.current.value = ''
  }

  const deleteEverything = () =>
    void run('delete', async () => {
      await deleteAllData()
      // Reset the gate so the section returns to its resting state behind the status line.
      setConfirmingDelete(false)
      setDeleteConfirmation('')
      return 'Deleted all activities, entries and check-offs from this device.'
    })

  return (
    // Mostly explanatory prose, so it is capped at a readable line length.
    <section className="screen-pad mx-auto w-full max-w-2xl">
      <h1 className="text-xl font-semibold text-ink">Settings</h1>

      <Section title="Data">
        <p className="text-sm text-ink-muted">
          A JSON backup restores exactly what you export, deletions included; the CSV is for a
          spreadsheet and cannot be imported back.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => exportFile('json', 'application/json', exportJson)} disabled={busy}>
            Export JSON
          </Button>
          <Button onClick={() => exportFile('csv', 'text/csv', exportCsv)} disabled={busy}>
            Export CSV
          </Button>
          <Button onClick={() => fileInput.current?.click()} disabled={busy}>
            Import JSON
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importFile(file)
          }}
        />
        <StatusLine status={status} section="data" />
      </Section>

      <Section title="App">
        <p className="text-sm text-ink-muted">
          The app is cached on this device and works with no network. Updates install in the
          background; when one is ready a bar offers to reload.
        </p>
        <div className="mt-3">
          <Button onClick={() => void run('app', checkForUpdate)} disabled={busy}>
            Check for updates
          </Button>
        </div>
        <StatusLine status={status} section="app" />
      </Section>

      <Section title="Sync">
        <p className="text-sm text-ink-muted">
          Paste the same sync token on every device to keep them in step. There is no account and
          no password — the token is the whole of it, it is stored on this device only, and it
          never travels with your data.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            // A secret, so it is not left legible on a screen someone else can see. Pasting into
            // a password field still works everywhere.
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            aria-label="Sync token"
            placeholder="Sync token"
            className="min-w-48 flex-1 rounded-lg bg-raised px-3 py-2 text-ink focus-ring"
          />
          <Button onClick={saveToken} disabled={busy}>
            Save token
          </Button>
          <Button
            onClick={() => void run('sync', syncAndReport)}
            disabled={busy || token.length === 0}
          >
            Sync now
          </Button>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          {lastSyncAt === 0
            ? 'Never synced from this device.'
            : `Last synced ${toDateTimeInput(lastSyncAt).replace('T', ' ')}.`}
        </p>
        <StatusLine status={status} section="sync" />
      </Section>

      <Section title="Delete all data">
        <p className="text-sm text-ink-muted">
          Permanently erase every activity, entry and check-off stored on this device. This cannot
          be undone. Your sync token stays, so a device still holding this data would sync it back.
        </p>
        {!confirmingDelete ? (
          <div className="mt-3">
            <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
              Delete all data
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              aria-label={`Type ${DELETE_CONFIRMATION} to delete all data`}
              placeholder={`Type ${DELETE_CONFIRMATION}`}
              autoFocus
              className="min-w-48 flex-1 rounded-lg bg-raised px-3 py-2 text-ink focus-ring"
            />
            <Button
              variant="danger"
              onClick={deleteEverything}
              disabled={busy || !deleteConfirmed}
            >
              Delete everything
            </Button>
          </div>
        )}
        <StatusLine status={status} section="delete" />
      </Section>

      <p className="mt-4 text-center text-2xs text-ink-muted">Version {__APP_VERSION__}</p>
    </section>
  )
}

/**
 * Ask the service worker to look for a new build now, rather than waiting for the
 * hourly check `UpdatePrompt` runs. Finding one is that component's business — it is
 * the thing listening — so this only reports whether the search turned anything up.
 */
async function checkForUpdate(): Promise<string> {
  const registration = await navigator.serviceWorker?.getRegistration()
  if (!registration) return 'This copy is not installed, so there is nothing to update.'

  try {
    await registration.update()
  } catch {
    // Offline is the normal case for this app, not an error worth a stack trace.
    return 'Could not check for updates without a connection.'
  }
  return registration.installing || registration.waiting
    ? 'An update is downloading.'
    : 'You are on the latest version.'
}

/** Hand the browser a file. Revoking on the next frame keeps Safari's download alive. */
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** The outcome of the last button pressed, shown under the section whose button it was. */
function StatusLine({ status, section }: { status: Status; section: Section }) {
  if (!status || status.section !== section) return null

  return (
    <p
      role="status"
      className={`mt-3 text-sm ${status.tone === 'error' ? 'text-danger' : 'text-positive'}`}
    >
      {status.message}
    </p>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 panel p-4">
      <h2 className="font-medium text-ink">{title}</h2>
      <div className="mt-1">{children}</div>
    </div>
  )
}

