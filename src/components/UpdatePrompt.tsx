/**
 * The update-available flow.
 *
 * The service worker precaches the shell, so a running app keeps serving the version
 * it was installed with until something swaps it. Swapping silently mid-session would
 * reload the screen under the owner's thumb — possibly while a timer is being toggled —
 * so the new version waits and this bar offers the reload.
 *
 * Mounted in `App.tsx` rather than on Settings: an update nobody visits Settings to
 * find is an update that never lands.
 */
import { X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import Button, { IconButton } from './ui/Button.tsx'

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="docked flex items-center gap-3 rounded-xl bg-raised p-3 shadow-lg"
    >
      <p className="flex-1 text-sm text-ink">A new version is ready.</p>
      <Button variant="primary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </Button>
      <IconButton label="Dismiss" onClick={() => setNeedRefresh(false)} className="size-8">
        <X className="size-4" />
      </IconButton>
    </div>
  )
}
