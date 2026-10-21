import { cn } from 'cn'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import * as React from 'react'

import { Popover, PopoverContent } from '@i-thinking/design/components/popover'

import { clampCursor, isDateDisabled } from './calendar-math'
import { findDefaultFormat, formatDate, startOfPicker } from './format'
import { PickerFooter } from './footer'
import { SurfaceBody } from './surface-body'
import { PickerTrigger } from './trigger'
import type { PickerKind, RangePickerProps, RangeValue, SurfaceMode } from './types'

function resolveInitialMode(picker: PickerKind): SurfaceMode {
  if (picker === 'year') return 'year'
  if (picker === 'month') return 'month'
  return 'date'
}

function normalizeRange(start: Dayjs, end: Dayjs): RangeValue {
  if (start.isAfter(end)) return [end, start]
  return [start, end]
}

function RangePicker(props: RangePickerProps) {
  const picker: PickerKind = props.picker ?? 'date'
  const format = props.format ?? findDefaultFormat(picker, props.showTime)
  const allowClear = props.allowClear !== false
  const showNow = props.showNow !== false
  const isControlled = props.value !== undefined
  const isOpenControlled = props.open !== undefined

  const [draft, setDraft] = React.useState<RangeValue | null>(function () {
    return props.defaultValue ?? null
  })
  const [innerOpen, setInnerOpen] = React.useState(!!props.defaultOpen)
  const [mode, setMode] = React.useState<SurfaceMode>(function () {
    return resolveInitialMode(picker)
  })
  const [slideDir, setSlideDir] = React.useState<1 | -1>(1)
  const [hoverDate, setHoverDate] = React.useState<Dayjs | null>(null)
  const [pickingEnd, setPickingEnd] = React.useState(false)
  /** 受控模式下点选 start 后、尚未闭合前的临时起点 */
  const [activeStart, setActiveStart] = React.useState<Dayjs | null>(null)

  const value = isControlled ? (props.value ?? null) : draft
  const rangeStart = activeStart ?? value?.[0] ?? null
  const rangeEnd = activeStart ? null : (value?.[1] ?? null)

  const [cursor, setCursor] = React.useState<Dayjs>(function () {
    return (value?.[0] ?? dayjs()).startOf('month')
  })

  const isOpen = isOpenControlled ? !!props.open : innerOpen
  const isDisabled = !!(props.disabled || props.readOnly)
  const bounds = {
    minDate: props.minDate,
    maxDate: props.maxDate,
    disabledDate: props.disabledDate
  }

  const placeholders = Array.isArray(props.placeholder)
    ? props.placeholder
    : ([props.placeholder ?? '开始', '结束'] as [string, string])

  function setOpen(open: boolean) {
    if (isDisabled && open) return
    if (!isOpenControlled) setInnerOpen(open)
    props.onOpenChange?.(open)
  }

  function commit(next: RangeValue | null) {
    if (!isControlled) setDraft(next)
    const strings: [string, string] = next
      ? [formatDate(next[0], format), formatDate(next[1], format)]
      : ['', '']
    props.onChange?.(next, strings)
  }

  function syncOpenState() {
    setMode(resolveInitialMode(picker))
    setPickingEnd(false)
    setActiveStart(null)
    setHoverDate(null)
    setCursor(clampCursor((value?.[0] ?? dayjs()).startOf('month'), bounds))
  }

  function pickUnit(date: Dayjs) {
    const unit = startOfPicker(date, picker)
    if (isDateDisabled(unit, picker, bounds)) return

    if (!pickingEnd || !rangeStart) {
      setActiveStart(unit)
      if (!isControlled) setDraft([unit, null])
      setPickingEnd(true)
      setHoverDate(null)
      return
    }

    const next = normalizeRange(rangeStart, unit)
    setActiveStart(null)
    commit(next)
    setPickingEnd(false)
    setHoverDate(null)
    setOpen(false)
  }

  function selectMonth(date: Dayjs) {
    if (picker === 'date') {
      setSlideDir(1)
      setCursor(date.startOf('month'))
      setMode('date')
      return
    }
    pickUnit(date)
  }

  function selectYear(date: Dayjs) {
    if (picker === 'year') {
      pickUnit(date)
      return
    }
    setSlideDir(1)
    setCursor(cursor.year(date.year()).startOf('month'))
    setMode('month')
  }

  const label =
    rangeStart || rangeEnd
      ? `${formatDate(rangeStart, format) || placeholders[0]} ~ ${formatDate(rangeEnd, format) || placeholders[1]}`
      : `${placeholders[0]} ~ ${placeholders[1]}`

  return (
    <Popover
      open={isOpen}
      onOpenChange={function (open) {
        if (open) syncOpenState()
        else {
          setHoverDate(null)
          setActiveStart(null)
          if (pickingEnd && !isControlled) setDraft(value?.[1] ? value : null)
          setPickingEnd(false)
        }
        setOpen(open)
      }}>
      {props.name ? (
        <input
          type="hidden"
          name={props.name}
          value={
            rangeStart && rangeEnd
              ? `${formatDate(rangeStart, format)},${formatDate(rangeEnd, format)}`
              : ''
          }
          disabled={props.disabled}
          readOnly={props.readOnly}
        />
      ) : null}
      <PickerTrigger
        id={props.id}
        disabled={isDisabled}
        autoFocus={props.autoFocus}
        tabIndex={props.tabIndex}
        title={props.title}
        style={props.style}
        className={props.className}
        label={label}
        isEmpty={!rangeStart && !rangeEnd}
        aria-invalid={props['aria-invalid']}
        aria-label={props['aria-label']}
        aria-describedby={props['aria-describedby']}
        onBlur={props.onBlur}
      />
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn('w-72 gap-0 overflow-hidden p-0')}
        onMouseLeave={function () {
          setHoverDate(null)
        }}>
        <SurfaceBody
          picker={picker}
          mode={mode}
          cursor={cursor}
          slideDir={slideDir}
          rangeStart={rangeStart}
          rangeEnd={pickingEnd ? null : rangeEnd}
          hoverDate={pickingEnd ? hoverDate : null}
          bounds={bounds}
          onModeChange={setMode}
          onCursorChange={function (next, dir) {
            setSlideDir(dir)
            setCursor(clampCursor(next, bounds))
          }}
          onSelectDate={pickUnit}
          onSelectMonth={selectMonth}
          onSelectYear={selectYear}
          onHover={function (date) {
            if (pickingEnd) setHoverDate(date)
          }}
        />
        <PickerFooter
          allowClear={allowClear}
          showNow={showNow}
          nowLabel={picker === 'year' ? '今年' : picker === 'month' ? '本月' : '今天'}
          hasValue={!!(rangeStart || rangeEnd)}
          nowDisabled={isDateDisabled(dayjs(), picker, bounds)}
          onClear={function () {
            setActiveStart(null)
            commit(null)
            setPickingEnd(false)
            setHoverDate(null)
            setOpen(false)
          }}
          onNow={function () {
            const now = startOfPicker(dayjs(), picker)
            if (isDateDisabled(now, picker, bounds)) return
            setActiveStart(null)
            commit([now, now])
            setPickingEnd(false)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export { RangePicker }
