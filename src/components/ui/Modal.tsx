import { useEffect, useRef, type ReactNode } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  label: string
  className?: string
  children: ReactNode
}

/**
 * A thin wrapper over the native `<dialog>`, which already supplies the focus trap,
 * Esc-to-close, inert background and `::backdrop` that a modal library would be carrying.
 * All this adds is React state syncing and a backdrop click.
 *
 * `ForgottenPrompt` deliberately uses a bare `<dialog>` instead: its open-ness is derived
 * from a live query rather than held in state, so there is no mount for this effect to fire
 * on. Two patterns, each where it fits.
 */
export function Modal({ open, onClose, label, className = '', children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      // Esc and the close button both surface here, so React state cannot drift out of sync
      // with whether the dialog is actually showing.
      onClose={onClose}
      // A click that lands on the dialog element itself landed on the backdrop: the content
      // below fills it edge to edge, so nothing else can be the target.
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
      className={`bg-transparent p-0 text-ink backdrop:bg-black/60 ${className}`}
    >
      {/* Unmounting the body on close is what resets form state between openings. */}
      {open && children}
    </dialog>
  )
}
