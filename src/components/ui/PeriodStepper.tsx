import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from './Button.tsx'

/**
 * Step back and forth through time, with the period you are looking at named between
 * the arrows.
 *
 * The label belongs inside the control. Both screens that page through periods used to
 * put two filled grey squares in the header and the label on its own line underneath,
 * which cost a row and left the label reading as a subtitle rather than as the answer to
 * "which week is this".
 *
 * Ghost arrows, so a step you cannot take is an arrow that has faded rather than a
 * filled box with something illegible in it. An absent `onNext` is the normal state at
 * the present period — nothing is recorded ahead of now.
 */
export default function PeriodStepper({
  label,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  className = '',
}: {
  label: string
  previousLabel: string
  nextLabel: string
  onPrevious: () => void
  /** Absent when there is nowhere forward to go. */
  onNext?: () => void
  className?: string
}) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <IconButton label={previousLabel} onClick={onPrevious}>
        <ChevronLeft className="size-5" />
      </IconButton>
      <p className="min-w-0 flex-1 truncate text-center text-sm font-medium text-ink">{label}</p>
      <IconButton label={nextLabel} onClick={onNext} disabled={!onNext}>
        <ChevronRight className="size-5" />
      </IconButton>
    </div>
  )
}
