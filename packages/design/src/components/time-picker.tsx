import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import * as React from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { FIELD_SHELL } from '../lib/surface'

const HOURS = Array.from({ length: 24 }, function (_, index) {
  return index
})

/** 选项行高（与按钮 h-8 一致），箭头步进与 scroll-padding 共用 */
const ITEM_HEIGHT = 32

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

/** 与 SelectChevron 同形，保证时分列箭头与 Select 滚动箭头视觉一致 */
function TimeChevron(props: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className={cn('pointer-events-none size-4 shrink-0', props.className)}>
      <path
        d="M4 6.25 8 10.25l4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
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
  isActive: boolean
  onSelect: (value: number) => void
}

/**
 * 时/分列：对齐 Select 列表壳——外壳不滚、隐藏滚动条，可滚时用上下箭头代替。
 */
function TimeColumn(props: TimeColumnProps) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const selectedRef = React.useRef<HTMLButtonElement>(null)
  const scrollRafRef = React.useRef(0)
  const snapTimerRef = React.useRef(0)
  const [canScrollUp, updateCanScrollUp] = React.useState(false)
  const [canScrollDown, updateCanScrollDown] = React.useState(false)

  function syncScrollEdges() {
    const node = listRef.current
    if (!node) return
    const { scrollTop, scrollHeight, clientHeight } = node
    updateCanScrollUp(scrollTop > 1)
    updateCanScrollDown(scrollTop + clientHeight < scrollHeight - 1)
  }

  /** 滚动停下后把最近的一行吸到中线：滚轮、点箭头松手都不会停在半行上 */
  function scheduleSnap() {
    window.clearTimeout(snapTimerRef.current)
    // 箭头长按期间一直在滚，等松手（stopArrowScroll）再吸
    if (scrollRafRef.current) return
    snapTimerRef.current = window.setTimeout(snapToNearest, 140)
  }

  function snapToNearest() {
    const node = listRef.current
    if (!node) return
    // 顶/底两端保持贴合：别为了「让最接近的一行居中」把首行推开半截
    if (node.scrollTop <= 1) return
    if (node.scrollTop >= node.scrollHeight - node.clientHeight - 1) return
    const center = node.clientHeight / 2
    let best = node.scrollTop
    let smallest = Number.POSITIVE_INFINITY
    node.querySelectorAll<HTMLElement>('[role="option"]').forEach(function (option) {
      const desired = option.offsetTop + option.offsetHeight / 2 - center
      const delta = Math.abs(desired - node.scrollTop)
      if (delta < smallest) {
        smallest = delta
        best = desired
      }
    })
    if (Math.abs(best - node.scrollTop) < 0.5) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollTo({ top: best, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  function handleScroll() {
    syncScrollEdges()
    scheduleSnap()
  }

  function stopArrowScroll() {
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = 0
      scheduleSnap()
    }
  }

  /** 键盘：↑↓/Home/End 直接改选中项（列自己收焦点，见 listbox 的 tabIndex） */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const current = props.values.indexOf(props.selected)
    const from = current < 0 ? 0 : current
    let next = -1
    if (event.key === 'ArrowDown') next = Math.min(props.values.length - 1, from + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, from - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = props.values.length - 1
    if (next < 0) return
    event.preventDefault()
    props.onSelect(props.values[next])
  }

  function startArrowScroll(direction: 1 | -1) {
    stopArrowScroll()
    // 刚起了连续滚动：把 stop 时排上的吸附取消，别等 140ms 后回来跟长按抢滚动
    window.clearTimeout(snapTimerRef.current)
    function tick() {
      const node = listRef.current
      if (!node) return
      node.scrollTop += direction * 2.5
      syncScrollEdges()
      const atEdge =
        direction < 0
          ? node.scrollTop <= 1
          : node.scrollTop + node.clientHeight >= node.scrollHeight - 1
      if (atEdge) {
        stopArrowScroll()
        return
      }
      scrollRafRef.current = requestAnimationFrame(tick)
    }
    scrollRafRef.current = requestAnimationFrame(tick)
  }

  React.useEffect(
    function () {
      if (!props.isActive) return
      // behavior: 'instant' —— 打开浮层时直接落到选中项，不要跟着 scroll-smooth 慢慢滑过去，
      // 也不要让两列的平滑滚动互相取消（时列会停在 0）
      selectedRef.current?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'instant'
      })
      requestAnimationFrame(syncScrollEdges)
    },
    [props.isActive, props.selected]
  )

  React.useEffect(function () {
    const node = listRef.current
    if (!node) return
    syncScrollEdges()
    const observer = new ResizeObserver(syncScrollEdges)
    observer.observe(node)
    return function () {
      observer.disconnect()
      window.clearTimeout(snapTimerRef.current)
    }
  }, [])

  return (
    <div className="relative isolate flex min-h-0 min-w-12 flex-1 flex-col overflow-hidden">
      {/*
        列表区必须有确定高度才能 overflow 滚动；用 flex-1 + min-h-0 + 绝对铺满，
        避免内容高度回传把外层（含 DatePicker）撑爆。
        列本身不画边框/底色：两列合在一张浮层面上，只留中间一条短线分栏，
        表头文字由 aria-label 承担，视觉上不占一行。
      */}
      <div className="relative isolate min-h-0 flex-1 overflow-hidden">
        {canScrollUp ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`向上滚动${props.label}`}
            className="absolute inset-x-0 top-0 z-10 flex h-7 items-start justify-center bg-linear-to-b from-popover from-75% to-transparent pt-1 text-muted-foreground/60 transition-colors hover:text-foreground"
            onPointerEnter={function () {
              startArrowScroll(-1)
            }}
            onPointerLeave={stopArrowScroll}
            onPointerUp={stopArrowScroll}
            onClick={function () {
              listRef.current?.scrollBy({ top: -ITEM_HEIGHT, behavior: 'smooth' })
            }}>
            <TimeChevron className="size-3.5 rotate-180" />
          </button>
        ) : null}
        <div
          ref={listRef}
          role="listbox"
          aria-label={props.label}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          className={cn(
            'group/col absolute inset-0 overflow-x-hidden overflow-y-auto scroll-smooth p-1 motion-reduce:scroll-auto',
            'scroll-py-7 scrollbar-none [&::-webkit-scrollbar]:hidden',
            // 列自己收焦点（选项 tabIndex=-1）：浮层打开时不会去聚焦首个选项、把整列滚回顶部。
            // 焦点指示不给整列描边（上下边被渐隐箭头层遮住，只剩两条竖线像渲染出错），
            // 改成「列有键盘焦点时选中项描一圈」，见选项上的 group-focus-visible/col
            'rounded-md outline-none'
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
                tabIndex={-1}
                className={cn(
                  'flex h-8 w-full shrink-0 items-center justify-center rounded-md text-sm tabular-nums transition-[background-color,color,box-shadow] duration-150',
                  // 选中沿用 Select 选中项的语言：浅主色 + 中粗；列底不再有 muted 底，浅主色足够看清
                  isSelected
                    ? 'bg-primary/10 dark:bg-primary/20 font-semibold text-foreground group-focus-visible/col:ring-1 group-focus-visible/col:ring-ring/40 group-focus-visible/col:ring-inset'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                onClick={function () {
                  props.onSelect(value)
                  // 鼠标点完把焦点还给列：否则焦点留在 tabIndex=-1 的选项上，↑↓ 就断了
                  listRef.current?.focus({ preventScroll: true })
                }}>
                {pad2(value)}
              </button>
            )
          })}
        </div>
        {canScrollDown ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`向下滚动${props.label}`}
            className="absolute inset-x-0 bottom-0 z-10 flex h-7 items-end justify-center bg-linear-to-t from-popover from-75% to-transparent pb-1 text-muted-foreground/60 transition-colors hover:text-foreground"
            onPointerEnter={function () {
              startArrowScroll(1)
            }}
            onPointerLeave={stopArrowScroll}
            onPointerUp={stopArrowScroll}
            onClick={function () {
              listRef.current?.scrollBy({ top: ITEM_HEIGHT, behavior: 'smooth' })
            }}>
            <TimeChevron className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

interface TimeSurfaceProps {
  hour: number
  minute: number
  step?: number
  isActive?: boolean
  onChange: (hour: number, minute: number) => void
  /** 选完分钟时回调（便于 datetime 自动提交） */
  onMinuteCommit?: (hour: number, minute: number) => void
  className?: string
}

/** 时/分双列，供 TimePicker 浮层与 DatePicker.showTime 复用；`step` 为分钟步进 */
function TimeSurface(props: TimeSurfaceProps) {
  const minuteStep =
    props.step !== undefined && Number.isFinite(props.step) && props.step > 0
      ? Math.min(30, Math.max(1, Math.round(props.step)))
      : 1
  const minutes = buildMinutes(minuteStep)
  const selectedMinute =
    minutes.find(function (minute) {
      return minute === props.minute
    }) ??
    minutes.reduce(function (closest, minute) {
      return Math.abs(minute - props.minute) < Math.abs(closest - props.minute) ? minute : closest
    }, minutes[0] ?? 0)
  const isActive = props.isActive !== false

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 gap-1 overflow-hidden', props.className)}>
      <TimeColumn
        label="时"
        values={HOURS}
        selected={props.hour}
        isActive={isActive}
        onSelect={function (hour) {
          props.onChange(hour, selectedMinute)
        }}
      />
      <div
        aria-hidden
        className="my-2 w-px shrink-0 self-stretch bg-border"
      />
      <TimeColumn
        label="分"
        values={minutes}
        selected={selectedMinute}
        isActive={isActive}
        onSelect={function (minute) {
          props.onChange(props.hour, minute)
          props.onMinuteCommit?.(props.hour, minute)
        }}
      />
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
        aria-label="选择时间"
        className="flex h-60 w-48 flex-col gap-0 overflow-hidden p-2">
        <TimeSurface
          hour={parsed.hour}
          minute={parsed.minute}
          step={parseMinuteStep(step)}
          isActive={isOpen}
          className="h-full min-h-0"
          onChange={commit}
          onMinuteCommit={function (hour, minute) {
            commit(hour, minute)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export { TimePicker, TimeSurface, formatTimeValue, parseTimeValue }
export type { TimePickerProps, TimeSurfaceProps }
