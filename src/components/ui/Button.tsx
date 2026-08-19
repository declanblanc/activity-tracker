import type { ComponentProps, ReactNode } from 'react'

/**
 * The app's buttons, in one place.
 *
 * There were four of these — `RowButton`, `WeekButton`, `StepButton` and Settings' own
 * `Button` — with the same classes typed out four times and, inevitably, drift: a
 * disabled control faded to 25% in three screens and to 50% in the fourth. Two more
 * variants were inlined at a dozen call sites. They are all this.
 *
 * `min-h-11` on every variant, not just the icon ones: a 44px target is the floor on a
 * phone, and the buttons that missed it missed it silently.
 */
const VARIANTS = {
  /** The one thing to do on this screen. At most one per view. */
  primary: 'bg-accent text-on-accent enabled:hover:bg-accent-hover',
  /** Everything else with a surface. */
  quiet: 'bg-raised text-ink enabled:hover:bg-raised-hover',
  /**
   * A control that should not draw the eye until it is looked for.
   *
   * A ghost toggle is the one variant whose `aria-pressed` had nothing to show: no surface
   * to fill, and on a phone its label is `sr-only`, so "Compact" and "Reorder" changed
   * nothing visible when tapped. On now reads as the `quiet` surface with accent text —
   * the same accent-as-foreground the active tab uses, and not a second filled accent
   * button competing with the one primary. The hover pair is not redundant: `ghost`'s own
   * `hover:text-ink` is more specific than a bare `aria-pressed:`, so without it the state
   * drops out from under the cursor that is pointing at it.
   */
  ghost:
    'text-ink-muted enabled:hover:bg-raised enabled:hover:text-ink aria-pressed:bg-raised aria-pressed:text-accent-ink aria-pressed:enabled:hover:bg-raised-hover aria-pressed:enabled:hover:text-accent-ink',
  /** Destructive, and deliberately not a filled red button: it sits beside Save. */
  danger: 'bg-raised text-danger enabled:hover:bg-raised-hover',
} as const

type Variant = keyof typeof VARIANTS

const BASE =
  'focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40'

export default function Button({
  variant = 'quiet',
  className = '',
  ...rest
}: ComponentProps<'button'> & { variant?: Variant }) {
  return (
    // `type="button"` first so a caller inside a form can still pass `type="submit"`.
    <button type="button" className={`${BASE} px-4 ${VARIANTS[variant]} ${className}`} {...rest} />
  )
}

/**
 * A button whose whole content is an icon, so its name has to come from somewhere else.
 *
 * `label` is required rather than optional — an icon-only control with no accessible
 * name is the single easiest a11y bug to ship, and making the prop mandatory is the
 * cheapest way to make it unshippable.
 *
 * The size class is the whole height here, so this does not carry `BASE`'s `min-h-11`: at the
 * default `size-11` the two agree, and `compact` deliberately drops below the 44px floor to
 * `size-9` — a density trade the compact dashboard opts into, where a 44px `min-h` would only
 * fight the smaller size and win.
 */
const ICON_BASE =
  'focus-ring inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40'

export function IconButton({
  label,
  variant = 'ghost',
  compact = false,
  className = '',
  children,
  ...rest
}: Omit<ComponentProps<'button'>, 'aria-label'> & {
  label: string
  variant?: Variant
  /** Shrink to `size-9` for the compact dashboard, below the usual 44px target. */
  compact?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`${ICON_BASE} ${compact ? 'size-9' : 'size-11'} shrink-0 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
