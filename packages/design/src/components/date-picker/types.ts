import type { Dayjs } from 'dayjs'
import type * as React from 'react'

/** 首批支持的选择粒度（不含 week / quarter） */
type PickerKind = 'date' | 'month' | 'year'

/** 日历表面视图：可下钻到更粗粒度 */
type SurfaceMode = 'date' | 'month' | 'year'

type RangeValue = [Dayjs | null, Dayjs | null]

type ShowTimeConfig = boolean | { step?: number }

interface DateBounds {
  minDate?: Dayjs | null
  maxDate?: Dayjs | null
  disabledDate?: (current: Dayjs) => boolean
}

interface DatePickerSharedProps extends DateBounds {
  className?: string
  disabled?: boolean
  readOnly?: boolean
  allowClear?: boolean
  showNow?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  format?: string
  id?: string
  name?: string
  autoFocus?: boolean
  tabIndex?: number
  title?: string
  style?: React.CSSProperties
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
  'aria-label'?: string
  'aria-describedby'?: string
}

interface DatePickerProps extends DatePickerSharedProps {
  picker?: PickerKind
  showTime?: ShowTimeConfig
  value?: Dayjs | null
  defaultValue?: Dayjs | null
  onChange?: (date: Dayjs | null, dateString: string) => void
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
  placeholder?: string
}

interface RangePickerProps extends DatePickerSharedProps {
  picker?: PickerKind
  showTime?: ShowTimeConfig
  value?: RangeValue | null
  defaultValue?: RangeValue | null
  onChange?: (dates: RangeValue | null, dateStrings: [string, string]) => void
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
  placeholder?: string | [string, string]
}

interface CalendarCell {
  date: Dayjs
  isOutside: boolean
}

export type {
  CalendarCell,
  DateBounds,
  DatePickerProps,
  DatePickerSharedProps,
  PickerKind,
  RangePickerProps,
  RangeValue,
  ShowTimeConfig,
  SurfaceMode
}
