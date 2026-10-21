import { cn } from 'cn'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import * as React from 'react'

import { Popover, PopoverContent } from '@i-thinking/design/components/popover'
import { TimeSurface } from '@i-thinking/design/components/time-picker'

import { clampCursor, isDateDisabled, mergeDateAndTime } from './calendar-math'
import { findDefaultFormat, findMinuteStep, formatDate, hasShowTime } from './format'
import { PickerFooter } from './footer'
import { SurfaceBody } from './surface-body'
import { PickerTrigger } from './trigger'
import type { DatePickerProps, PickerKind, SurfaceMode } from './types'

function resolveInitialMode(picker: PickerKind): SurfaceMode {
  if (picker === 'year') return 'year'
  if (picker === 'month') return 'month'
  return 'date'
}

function DatePicker(props: DatePickerProps) {
  const picker: PickerKind = props.picker ?? 'date'
  const withTime = picker === 'date' && hasShowTime(props.showTime)
  const format = props.format ?? findDefaultFormat(picker, props.showTime)
  const allowClear = props.allowClear !== false
  const showNow = props.showNow !== false
  const isControlled = props.value !== undefined
  const isOpenControlled = props.open !== undefined

  const [draft, setDraft] = React.useState<Dayjs | null>(function () {
    return props.defaultValue ?? null
  })
  const [innerOpen, setInnerOpen] = React.useState(!!props.defaultOpen)
  const [mode, setMode] = React.useState<SurfaceMode>(function () {
    return resolveInitialMode(picker)
  })
  const [slideDir, setSlideDir] = React.useState<1 | -1>(1)
  const [cursor, setCursor] = React.useState<Dayjs>(function () {
    return (props.value ?? props.defaultValue ?? dayjs()).startOf('month')
  })
  const [draftTime, setDraftTime] = React.useState(function () {
    const seed = props.value ?? props.defaultValue ?? dayjs()
    return { hour: seed.hour(), minute: seed.minute() }
  })
  /** showTime 受控：确认前本地暂存日期 */
  const [pendingDate, setPendingDate] = React.useState<Dayjs | null>(null)

  const committed = isControlled ? (props.value ?? null) : draft
  const selected = withTime ? (pendingDate ?? committed) : committed
  const isOpen = isOpenControlled ? !!props.open : innerOpen
  const isDisabled = !!(props.disabled || props.readOnly)
  const bounds = {
    minDate: props.minDate,
    maxDate: props.maxDate,
    disabledDate: props.disabledDate
  }
  const minuteStep = findMinuteStep(props.showTime)

  function setOpen(open: boolean) {
    if (isDisabled && open) return
    if (!isOpenControlled) setInnerOpen(open)
    props.onOpenChange?.(open)
  }

  function commit(next: Dayjs | null) {
    setPendingDate(null)
    if (!isControlled) setDraft(next)
    props.onChange?.(next, formatDate(next, format))
  }

  function syncOpenState(open: boolean) {
    if (!open) return
    setMode(resolveInitialMode(picker))
    const seed = committed ?? dayjs()
    setPendingDate(null)
    setCursor(clampCursor(seed.startOf('month'), bounds))
    setDraftTime({ hour: seed.hour(), minute: seed.minute() })
  }

  function emitWithTime(base: Dayjs) {
    const next = mergeDateAndTime(base, draftTime.hour, draftTime.minute)
    if (isDateDisabled(next, picker, bounds)) return
    commit(next)
    setOpen(false)
  }

  function selectDay(date: Dayjs) {
    if (isDateDisabled(date, picker, bounds)) return
    if (withTime) {
      setCursor(date.startOf('month'))
      const merged = mergeDateAndTime(date, draftTime.hour, draftTime.minute)
      setPendingDate(merged)
      if (!isControlled) setDraft(merged)
      return
    }
    commit(date.startOf('day'))
    setOpen(false)
  }

  function selectMonth(date: Dayjs) {
    if (picker === 'date') {
      setSlideDir(1)
      setCursor(date.startOf('month'))
      setMode('date')
      return
    }
    if (isDateDisabled(date, 'month', bounds)) return
    commit(date.startOf('month'))
    setOpen(false)
  }

  function selectYear(date: Dayjs) {
    if (picker === 'year') {
      if (isDateDisabled(date, 'year', bounds)) return
      commit(date.startOf('year'))
      setOpen(false)
      return
    }
    setSlideDir(1)
    setCursor(cursor.year(date.year()).startOf('month'))
    setMode('month')
  }

  function handleNow() {
    const now = dayjs()
    if (isDateDisabled(now, picker, bounds)) return
    if (withTime) {
      commit(now)
      setOpen(false)
      return
    }
    if (picker === 'year') commit(now.startOf('year'))
    else if (picker === 'month') commit(now.startOf('month'))
    else commit(now.startOf('day'))
    setOpen(false)
  }

  const label = selected
    ? formatDate(selected, format)
    : (props.placeholder ??
      (picker === 'year'
        ? '选择年份'
        : picker === 'month'
          ? '选择月份'
          : withTime
            ? '选择日期时间'
            : '年 / 月 / 日'))

  return (
    <Popover
      open={isOpen}
      onOpenChange={function (open) {
        if (open) syncOpenState(true)
        else setPendingDate(null)
        setOpen(open)
      }}>
      {props.name ? (
        <input
          type="hidden"
          name={props.name}
          value={formatDate(selected, format)}
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
        isEmpty={!selected}
        icon={withTime ? 'lucide:calendar-clock' : 'lucide:calendar'}
        aria-invalid={props['aria-invalid']}
        aria-label={props['aria-label']}
        aria-describedby={props['aria-describedby']}
        onBlur={props.onBlur}
      />
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn('w-auto gap-0 overflow-hidden p-0', withTime ? 'min-w-72' : 'w-72')}>
        {/*
          时分列不能参与 flex 行高计算：否则 24×32px 内容会把整行撑爆。
          用日历定高 + 右侧绝对铺满，列表在定高容器内滚动。
        */}
        <div className={cn(withTime && 'relative flex')}>
          <SurfaceBody
            picker={picker}
            mode={mode}
            cursor={cursor}
            slideDir={slideDir}
            selected={selected}
            bounds={bounds}
            onModeChange={setMode}
            onCursorChange={function (next, dir) {
              setSlideDir(dir)
              setCursor(clampCursor(next, bounds))
            }}
            onSelectDate={selectDay}
            onSelectMonth={selectMonth}
            onSelectYear={selectYear}
          />
          {withTime ? (
            <>
              <div
                className="w-36 shrink-0"
                aria-hidden
              />
              <div className="absolute inset-y-0 right-0 flex w-36 flex-col border-l border-border/70 p-2.5">
                <TimeSurface
                  hour={draftTime.hour}
                  minute={draftTime.minute}
                  step={minuteStep}
                  isActive={isOpen}
                  className="h-full min-h-0"
                  onChange={function (hour, minute) {
                    setDraftTime({ hour, minute })
                    if (selected) {
                      const merged = mergeDateAndTime(selected, hour, minute)
                      setPendingDate(merged)
                      if (!isControlled) setDraft(merged)
                    }
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
        <PickerFooter
          allowClear={allowClear}
          showNow={showNow}
          nowLabel={
            withTime ? '此刻' : picker === 'year' ? '今年' : picker === 'month' ? '本月' : '今天'
          }
          hasValue={!!selected}
          nowDisabled={isDateDisabled(dayjs(), picker, bounds)}
          showConfirm={withTime}
          confirmDisabled={false}
          onClear={function () {
            commit(null)
            setOpen(false)
          }}
          onNow={handleNow}
          onConfirm={function () {
            emitWithTime(selected ?? cursor)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
