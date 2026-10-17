import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import * as React from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@i-thinking/design/components/popover'
import { FIELD_SHELL } from '../lib/surface'

const HOURS = Array.from({ length: 24 }, function (_, index) {
  return index
})

const COLUMN_HEIGHT = 'h-48'

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function parseTimeValue(raw: string | undefined | null): { hour: number; minute: number } | null {
  if (!raw) return null
  const matched = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim())
  if (!matched) return null
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return null
  }
  return { hour, minute }
}

function formatTimeValue(hour: number, minute: number) {
  return `${pad2(hour)}:${pad2(minute)}`
}

/** HTML `time` 的 step 以秒计；列滚动按分钟步进 */
function parseMinuteStep(step: React.ComponentProps<'input'>['step']): number {
  if (step === undefined || step === 'any') return 1
  const seconds = Number(step)
  if (!Number.isFinite(seconds) || seconds <= 0) return 1
  const minutes = Math.max(1, Math.round(seconds / 60))
  return minutes >= 60 ? 1 : minutes
}

function buildMinutes(step: number) {
  const minutes: number[] = []
  for (let minute = 0; minute < 60; minute += step) {
    minutes.push(minute)
  }
  return minutes
}

function emitTimeChange(
  onChange: React.ChangeEventHandler<HTMLInputElement> | undefined,
  next: string,
  name?: string
) {
  if (!onChange) return
  onChange({
    target: { value: next, name: name ?? '' },
    currentTarget: { value: next, name: name ?? '' }
  } as React.ChangeEvent<HTMLInputElement>)
}

interface TimeColumnProps {
  label: string
  values: number[]
  selected: number
  isOpen: boolean
  onSelect: (value: number) => void
}

function TimeColumn(props: TimeColumnProps) {
  const selectedRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(
    function () {
      if (!props.isOpen) return
      selectedRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' })
    },
    [props.isOpen, props.selected]
  )

  return (
    <div className="flex min-w-13 flex-1 flex-col gap-1.5">
      <div className="px-1 text-center text-xs font-medium tracking-wide text-muted-foreground">
        {props.label}
      </div>
      <div
        role="listbox"
        aria-label={props.label}
        className={cn(
          COLUMN_HEIGHT,
          'overflow-y-auto scroll-smooth rounded-md border border-border/70 bg-muted/35 p-1'
        )}>
        {props.values.map(function (value) {
          const isSelected = value === props.selected
          return (
            <button
              key={value}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={cn(
                'flex h-8 w-full items-center justify-center rounded-md text-sm tabular-nums transition-[background-color,color,box-shadow] duration-150',
                isSelected
                  ? 'bg-primary font-medium text-primary-foreground shadow-sm'
                  : 'text-foreground hover:bg-background/80 hover:text-foreground'
              )}
              onClick={function () {
                props.onSelect(value)
              }}>
              {pad2(value)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type TimePickerProps = Omit<React.ComponentProps<'input'>, 'type'>

/**
 * 时间选择：整框可点开 Popover，时/分双列滚动。
 * `<Input type="time" />` 会落到这里，业务侧不必改调用方式。
 */
function TimePicker({
  className,
  disabled,
  readOnly,
  value,
  defaultValue,
  onChange,
  onBlur,
  id,
  name,
  step,
  placeholder,
  required,
  autoFocus,
  tabIndex,
  title,
  style,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy
}: TimePickerProps) {
  const isControlled = value !== undefined
  const [draft, setDraft] = React.useState(function () {
    if (defaultValue === undefined || defaultValue === null) return ''
    return String(defaultValue)
  })
  const [isOpen, setOpen] = React.useState(false)

  const display = isControlled
    ? value === undefined || value === null
      ? ''
      : String(value)
    : draft
  const parsed = parseTimeValue(display) ?? { hour: 9, minute: 0 }
  const minuteStep = parseMinuteStep(step)
  const minutes = buildMinutes(minuteStep)
  const selectedMinute =
    minutes.find(function (minute) {
      return minute === parsed.minute
    }) ??
    minutes.reduce(function (closest, minute) {
      return Math.abs(minute - parsed.minute) < Math.abs(closest - parsed.minute) ? minute : closest
    }, minutes[0] ?? 0)

  const isDisabled = Boolean(disabled || readOnly)

  function commit(hour: number, minute: number) {
    const next = formatTimeValue(hour, minute)
    if (!isControlled) setDraft(next)
    emitTimeChange(onChange, next, name)
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={function (open) {
        if (isDisabled && open) return
        setOpen(open)
      }}>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={display}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
        />
      ) : null}
      <PopoverTrigger
        id={id}
        disabled={isDisabled}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        title={title}
        style={style}
        aria-invalid={ariaInvalid || undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        aria-haspopup="dialog"
        className={cn(
          FIELD_SHELL,
          'relative flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-1 text-left text-base md:text-sm',
          'hover:bg-muted/40 data-popup-open:border-ring data-popup-open:ring-1 data-popup-open:ring-ring/40',
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
          'dark:bg-input/30 dark:hover:bg-input/50',
          className
        )}
        onBlur={onBlur as React.FocusEventHandler<HTMLButtonElement> | undefined}>
        <span
          className={cn(
            'min-w-0 flex-1 truncate tabular-nums text-foreground',
            !display && 'text-muted-foreground'
          )}>
          {display || placeholder || '--:--'}
        </span>
        <Icon
          icon="lucide:clock"
          className="pointer-events-none size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto min-w-48 gap-0 overflow-hidden p-2.5">
        <div className="flex gap-2">
          <TimeColumn
            label="时"
            values={HOURS}
            selected={parsed.hour}
            isOpen={isOpen}
            onSelect={function (hour) {
              commit(hour, selectedMinute)
            }}
          />
          <div
            aria-hidden
            className="w-px shrink-0 self-stretch bg-border"
          />
          <TimeColumn
            label="分"
            values={minutes}
            selected={selectedMinute}
            isOpen={isOpen}
            onSelect={function (minute) {
              commit(parsed.hour, minute)
              setOpen(false)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { TimePicker, formatTimeValue, parseTimeValue }
export type { TimePickerProps }
