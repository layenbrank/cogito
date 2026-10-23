import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import * as React from 'react'

import { PopoverTrigger } from '@cogito/design/components/popover'
import { FIELD_SHELL } from '#lib/surface'

interface PickerTriggerProps {
  id?: string
  disabled?: boolean
  autoFocus?: boolean
  tabIndex?: number
  title?: string
  style?: React.CSSProperties
  className?: string
  label: string
  isEmpty: boolean
  icon?: string
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-required'?: boolean
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
}

function PickerTrigger(props: PickerTriggerProps) {
  return (
    <PopoverTrigger
      id={props.id}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      tabIndex={props.tabIndex}
      title={props.title}
      style={props.style}
      aria-invalid={props['aria-invalid'] || undefined}
      aria-label={props['aria-label']}
      aria-describedby={props['aria-describedby']}
      aria-required={props['aria-required'] || undefined}
      aria-haspopup="dialog"
      className={cn(
        FIELD_SHELL,
        'relative flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-1 text-left text-base md:text-sm',
        'hover:bg-muted/40 data-popup-open:border-ring data-popup-open:ring-1 data-popup-open:ring-ring/40',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'dark:bg-input/30 dark:hover:bg-input/50',
        props.className
      )}
      onBlur={props.onBlur}>
      <span
        className={cn(
          'min-w-0 flex-1 truncate tabular-nums text-foreground',
          props.isEmpty && 'text-muted-foreground'
        )}>
        {props.label}
      </span>
      <Icon
        icon={props.icon ?? 'lucide:calendar'}
        className="pointer-events-none size-4 shrink-0 text-muted-foreground"
      />
    </PopoverTrigger>
  )
}

export { PickerTrigger }
