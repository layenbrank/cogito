import { cn } from 'cn'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { useAppReducedMotion } from '@i-thinking/design/hooks/use-app-reduced-motion'
import { TAP_SCALE, TAP_TRANSITION } from '@i-thinking/design/lib/motion'

interface CellButtonProps {
  children: ReactNode
  label: string
  isSelected?: boolean
  isToday?: boolean
  isOutside?: boolean
  isDisabled?: boolean
  isInRange?: boolean
  isRangeStart?: boolean
  isRangeEnd?: boolean
  onClick: () => void
  onMouseEnter?: () => void
  className?: string
}

function CellButton(props: CellButtonProps) {
  const isReduced = useAppReducedMotion()
  const isHighlight = !!(props.isSelected || props.isRangeStart || props.isRangeEnd)

  return (
    <motion.button
      type="button"
      aria-label={props.label}
      aria-current={props.isToday ? 'date' : undefined}
      aria-pressed={isHighlight || undefined}
      disabled={props.isDisabled}
      whileTap={isReduced || props.isDisabled ? undefined : { scale: TAP_SCALE }}
      transition={TAP_TRANSITION}
      className={cn(
        'relative flex size-8 min-w-0 items-center justify-center text-sm tabular-nums',
        'transition-[background-color,color,box-shadow] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:pointer-events-none disabled:opacity-35',
        props.isInRange && !isHighlight && 'bg-primary/10',
        props.isRangeStart && 'rounded-l-md rounded-r-none',
        props.isRangeEnd && 'rounded-r-md rounded-l-none',
        props.isRangeStart && props.isRangeEnd && 'rounded-md',
        isHighlight
          ? 'rounded-md bg-primary font-medium text-primary-foreground shadow-sm'
          : cn(
              'rounded-md hover:bg-muted',
              props.isOutside ? 'text-muted-foreground/45' : 'text-foreground',
              props.isToday && 'font-medium text-primary ring-1 ring-inset ring-primary/35'
            ),
        props.className
      )}
      onClick={props.onClick}
      onMouseEnter={props.onMouseEnter}>
      <span className="relative z-10">{props.children}</span>
    </motion.button>
  )
}

export { CellButton }
