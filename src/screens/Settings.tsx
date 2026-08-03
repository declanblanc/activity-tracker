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
import { exportCsv, exportJson, importJson } from '../data/transfer.ts'
import { toDateTimeInput } from '../lib/time.ts'

type Status = { tone: 'ok' | 'error'; message: string } | null

export default function Settings() {
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  /** Every button here can fail on a full disk or a bad file; none may leave the screen stuck. */
  async function run(job: () => Promise<string>) {
    setBusy(true)
    setStatus(null)
    try {
      setStatus({ tone: 'ok', message: await job() })
    } catch (error) {
      setStatus({ tone: 'error', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const exportFile = (extension: 'json' | 'csv', type: string, build: () => Promise<string>) =>
    run(async () => {
      const name = `time-tracker-${toDateTimeInput(Date.now()).slice(0, 10)}.${extension}`
      download(name, await build(), type)
      return `Saved ${name}.`
    })

  async function importFile(file: File) {
    await run(async () => {
      const { activities, entries } = await importJson(await file.text())
      return `Imported ${activities} ${plural(activities, 'activity', 'activities')} and ${entries} ${plural(entries, 'entry', 'entries')}.`
    })
    // Clear the input so re-picking the same file fires `change` again.
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    // Mostly explanatory prose, so it is capped at a readable line length.
    <section className="screen-pad mx-auto w-full max-w-2xl">
      <h1 className="text-xl font-semibold text-ink">Settings</h1>

      <Section title="Data">
        <p className="text-sm text-ink-muted">
          Everything is stored on this device. A JSON backup restores exactly what you export,
          deletions included; the CSV is for a spreadsheet and cannot be imported back.
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
        {status && (
          <p
            role="status"
            className={`mt-3 text-sm ${status.tone === 'error' ? 'text-danger' : 'text-positive'}`}
          >
            {status.message}
          </p>
        )}
      </Section>

      <Section title="App">
        <p className="text-sm text-ink-muted">
          The app is cached on this device and works with no network. Updates install in the
          background; when one is ready a bar offers to reload.
        </p>
        <div className="mt-3">
          <Button onClick={() => void run(checkForUpdate)} disabled={busy}>
            Check for updates
          </Button>
        </div>
      </Section>

      <Section title="Sync">
        <p className="text-sm text-ink-muted">
          Syncing across devices is off. There is no account and nothing leaves this device.
        </p>
      </Section>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 panel p-4">
      <h2 className="font-medium text-ink">{title}</h2>
      <div className="mt-1">{children}</div>
    </div>
  )
}

