import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

import type { PickerKind, ShowTimeConfig } from './types'

dayjs.extend(customParseFormat)

const FORMAT_DATE = 'YYYY-MM-DD'
const FORMAT_MONTH = 'YYYY-MM'
const FORMAT_YEAR = 'YYYY'
const FORMAT_DATETIME = 'YYYY-MM-DD HH:mm'

function hasShowTime(showTime: ShowTimeConfig | undefined) {
  return !!showTime
}

function findDefaultFormat(picker: PickerKind, showTime?: ShowTimeConfig) {
  if (picker === 'month') return FORMAT_MONTH
  if (picker === 'year') return FORMAT_YEAR
  if (hasShowTime(showTime)) return FORMAT_DATETIME
  return FORMAT_DATE
}

function formatDate(value: Dayjs | null | undefined, format: string) {
  if (!value || !value.isValid()) return ''
  return value.format(format)
}

function parseDate(raw: string | Dayjs | null | undefined, format?: string): Dayjs | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (dayjs.isDayjs(raw)) return raw.isValid() ? raw : null
  const parsed = format ? dayjs(raw, format, true) : dayjs(raw)
  return parsed.isValid() ? parsed : null
}

function findMinuteStep(showTime: ShowTimeConfig | undefined): number {
  if (!showTime || showTime === true) return 1
  const step = showTime.step
  if (step === undefined || !Number.isFinite(step) || step <= 0) return 1
  return Math.min(30, Math.max(1, Math.round(step)))
}

/** 按 picker 粒度对齐到单位起点（便于比较 / disabled） */
function startOfPicker(value: Dayjs, picker: PickerKind) {
  if (picker === 'year') return value.startOf('year')
  if (picker === 'month') return value.startOf('month')
  return value.startOf('day')
}

function isSamePicker(left: Dayjs | null | undefined, right: Dayjs | null | undefined, picker: PickerKind) {
  if (!left || !right || !left.isValid() || !right.isValid()) return false
  if (picker === 'year') return left.isSame(right, 'year')
  if (picker === 'month') return left.isSame(right, 'month')
  return left.isSame(right, 'day')
}

export {
  FORMAT_DATE,
  FORMAT_DATETIME,
  FORMAT_MONTH,
  FORMAT_YEAR,
  findDefaultFormat,
  findMinuteStep,
  formatDate,
  hasShowTime,
  isSamePicker,
  parseDate,
  startOfPicker
}
