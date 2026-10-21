import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { clamp, range } from 'lodash-es'

import type { CalendarCell, DateBounds, PickerKind } from './types'
import { startOfPicker } from './format'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const
const MONTHS = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月'
] as const

/** 周一为一周起点，铺满 6×7 */
function buildDayCells(cursor: Dayjs): CalendarCell[] {
  const monthStart = cursor.startOf('month')
  const mondayOffset = (monthStart.day() + 6) % 7
  const gridStart = monthStart.subtract(mondayOffset, 'day')

  return range(0, 42).map(function (index) {
    const date = gridStart.add(index, 'day')
    return {
      date,
      isOutside: date.month() !== cursor.month()
    }
  })
}

function buildMonthCells(year: number) {
  return range(0, 12).map(function (month) {
    return dayjs().year(year).month(month).startOf('month')
  })
}

/** 12 格：前一十年边界 + 十年 + 后边界 */
function buildYearCells(cursorYear: number) {
  const decadeStart = Math.floor(cursorYear / 10) * 10
  return range(decadeStart - 1, decadeStart + 11).map(function (year) {
    return {
      year,
      isOutside: year < decadeStart || year > decadeStart + 9
    }
  })
}

function findDecadeStart(year: number) {
  return Math.floor(year / 10) * 10
}

function shiftCursor(cursor: Dayjs, picker: PickerKind, delta: number) {
  if (picker === 'year') return cursor.add(delta * 10, 'year')
  if (picker === 'month') return cursor.add(delta, 'year')
  return cursor.add(delta, 'month')
}

function isDateDisabled(current: Dayjs, picker: PickerKind, bounds: DateBounds) {
  const unit = startOfPicker(current, picker)
  if (bounds.minDate && unit.isBefore(startOfPicker(bounds.minDate, picker))) return true
  if (bounds.maxDate && unit.isAfter(startOfPicker(bounds.maxDate, picker))) return true
  if (bounds.disabledDate?.(unit)) return true
  return false
}

function clampCursor(cursor: Dayjs, bounds: DateBounds) {
  let next = cursor
  if (bounds.minDate && next.isBefore(bounds.minDate, 'month')) {
    next = bounds.minDate.startOf('month')
  }
  if (bounds.maxDate && next.isAfter(bounds.maxDate, 'month')) {
    next = bounds.maxDate.startOf('month')
  }
  return next
}

function mergeDateAndTime(date: Dayjs, hour: number, minute: number) {
  return date.hour(clamp(hour, 0, 23)).minute(clamp(minute, 0, 59)).second(0).millisecond(0)
}

function isInRange(
  current: Dayjs,
  start: Dayjs | null | undefined,
  end: Dayjs | null | undefined,
  picker: PickerKind
) {
  if (!start || !end) return false
  const unit = startOfPicker(current, picker)
  const left = startOfPicker(start, picker)
  const right = startOfPicker(end, picker)
  const from = left.isBefore(right) ? left : right
  const to = left.isBefore(right) ? right : left
  return (unit.isAfter(from) || unit.isSame(from)) && (unit.isBefore(to) || unit.isSame(to))
}

function isRangeEdge(
  current: Dayjs,
  start: Dayjs | null | undefined,
  end: Dayjs | null | undefined,
  picker: PickerKind
) {
  if (start && startOfPicker(current, picker).isSame(startOfPicker(start, picker))) return 'start'
  if (end && startOfPicker(current, picker).isSame(startOfPicker(end, picker))) return 'end'
  return null
}

export {
  MONTHS,
  WEEKDAYS,
  buildDayCells,
  buildMonthCells,
  buildYearCells,
  clampCursor,
  findDecadeStart,
  isDateDisabled,
  isInRange,
  isRangeEdge,
  mergeDateAndTime,
  shiftCursor
}
