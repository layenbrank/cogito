import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import * as React from 'react'

import { TimePicker } from '@cogito/design/components/time-picker'
import { FOCUS_WITHIN, FOCUS_WITHIN_INVALID } from '../lib/focus'
import { FIELD_SHELL } from '../lib/surface'

/** 单行输入的壳：文本 / 文件 / 密码等共用；number 走 InputNumber */
const INPUT_SHELL = cn(
  FIELD_SHELL,
  'h-9 w-full min-w-0 px-3 py-1 text-base selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30'
)

function parseStep(step: React.ComponentProps<'input'>['step']): number {
  if (step === undefined || step === 'any') return 1
  const next = Number(step)
  return Number.isFinite(next) && next !== 0 ? next : 1
}

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value
  if (min !== undefined && Number.isFinite(min)) next = Math.max(min, next)
  if (max !== undefined && Number.isFinite(max)) next = Math.min(max, next)
  return next
}

function parseBound(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const next = Number(raw)
  return Number.isFinite(next) ? next : undefined
}

function emitNumberChange(
  onChange: React.ChangeEventHandler<HTMLInputElement> | undefined,
  next: string
) {
  if (!onChange) return
  onChange({
    target: { value: next },
    currentTarget: { value: next }
  } as React.ChangeEvent<HTMLInputElement>)
}

type InputNumberProps = Omit<React.ComponentProps<'input'>, 'type'>

interface NumberStepButtonProps {
  label: string
  icon: string
  edge: 'start' | 'end'
  disabled?: boolean
  onStep: () => void
}

/**
 * 步进键：悬停态用组件本地 state，不用 CSS `:hover` / `group-hover`。
 * 两侧各自一套，避免壳层透明底或父级 focus-within 看起来像「点 + 时 − 也变了」。
 */
function NumberStepButton(props: NumberStepButtonProps) {
  const [isHovered, setHovered] = React.useState(false)
  const [isPressed, setPressed] = React.useState(false)

  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={props.disabled}
      aria-label={props.label}
      className={cn(
        'inline-flex w-8 shrink-0 items-center justify-center self-stretch',
        'transition-[background-color,color,transform] duration-150',
        props.edge === 'start' ? 'border-r border-input' : 'border-l border-input',
        isHovered ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground',
        isPressed && 'scale-95 motion-reduce:scale-100',
        'disabled:pointer-events-none disabled:opacity-50'
      )}
      onPointerEnter={function () {
        setHovered(true)
      }}
      onPointerLeave={function () {
        setHovered(false)
        setPressed(false)
      }}
      onPointerDown={function (event) {
        // 避免抢走中间 input 的焦点，也避免壳层 focus-within 环跟着闪
        event.preventDefault()
        setPressed(true)
      }}
      onPointerUp={function () {
        setPressed(false)
      }}
      onClick={function () {
        props.onStep()
      }}>
      <Icon
        icon={props.icon}
        className="pointer-events-none size-3.5"
      />
    </button>
  )
}

/**
 * 数字输入：左右步进，中间可直接键入。
 * `type="number"` 的 `<Input />` 会自动落到这里，业务侧不必再包一层。
 */
function InputNumber({
  className,
  disabled,
  readOnly,
  min,
  max,
  step = 1,
  value,
  defaultValue,
  onChange,
  onBlur,
  ...props
}: InputNumberProps) {
  const isControlled = value !== undefined
  const [draft, setDraft] = React.useState(function () {
    if (defaultValue === undefined || defaultValue === null) return ''
    return String(defaultValue)
  })
  const display = isControlled
    ? value === undefined || value === null
      ? ''
      : String(value)
    : draft
  const stepSize = parseStep(step)
  const minBound = parseBound(min)
  const maxBound = parseBound(max)
  const isStepDisabled = Boolean(disabled || readOnly)

  function commit(raw: string) {
    if (!isControlled) setDraft(raw)
    emitNumberChange(onChange, raw)
  }

  function stepBy(direction: 1 | -1) {
    if (isStepDisabled) return
    const current = display === '' || Number.isNaN(Number(display)) ? 0 : Number(display)
    const next = clampNumber(current + direction * stepSize, minBound, maxBound)
    const pretty = Number.isInteger(stepSize) ? String(Math.round(next)) : String(next)
    commit(pretty)
  }

  return (
    <div
      data-slot="input-number"
      className={cn(
        'relative flex h-9 w-full min-w-0 items-stretch overflow-hidden rounded-md border border-input bg-background text-base shadow-xs transition-[border-color,box-shadow] md:text-sm dark:bg-input/30',
        FOCUS_WITHIN,
        FOCUS_WITHIN_INVALID,
        disabled && 'pointer-events-none cursor-not-allowed opacity-50',
        className
      )}>
      <NumberStepButton
        label="减少"
        icon="lucide:minus"
        edge="start"
        disabled={isStepDisabled}
        onStep={function () {
          stepBy(-1)
        }}
      />
      <input
        {...props}
        type="number"
        data-slot="input"
        inputMode="decimal"
        disabled={disabled}
        readOnly={readOnly}
        min={min}
        max={max}
        step={step}
        value={display}
        onChange={function (event) {
          if (!isControlled) setDraft(event.target.value)
          onChange?.(event)
        }}
        onBlur={onBlur}
        className={cn(
          'min-w-0 flex-1 border-0 bg-transparent px-2 py-1 text-center text-foreground tabular-nums outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
        )}
      />
      <NumberStepButton
        label="增加"
        icon="lucide:plus"
        edge="end"
        disabled={isStepDisabled}
        onStep={function () {
          stepBy(1)
        }}
      />
    </div>
  )
}

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  if (type === 'number') {
    return (
      <InputNumber
        className={className}
        {...props}
      />
    )
  }

  if (type === 'time') {
    return (
      <TimePicker
        className={className}
        {...props}
      />
    )
  }

  return (
    <input
      type={type}
      data-slot="input"
      className={cn(INPUT_SHELL, className)}
      {...props}
    />
  )
}

export { Input, InputNumber, INPUT_SHELL }
