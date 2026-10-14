import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { ToggleGroup, ToggleGroupItem } from '@i-thinking/design/components/toggle-group'
import { calendar, timeSphere } from '@i-thinking/utils'
import { clsx } from 'clsx'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { useState } from 'react'

import styles from '@/views/calendar/day-grid.module.scss'

type DayGridProps = {
  selectDate: Dayjs
  panelDate: Dayjs
  markedDates: Set<string>
  onSelectDate: (date: Dayjs) => void
  onPanelDate: (date: Dayjs) => void
}

type PanelMode = 'month' | 'year'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const
const COLUMN_COUNT = 7
const ROW_COUNT = 6
const MONTH_COUNT = 12

function findYearLabel(year: number) {
  const key = `${year}-06-15`
  const cycle = calendar.sixtyCycle(key)
  const lunarYear = calendar.format(key, 'lY')
  return `${lunarYear}年（${cycle.heavenStem}${cycle.earthBranch}${cycle.zodiac}年）`
}

function findMonthLabel(month: number, value: Dayjs) {
  const key = timeSphere.format(value.month(month).date(15).toDate(), 'YYYY-MM-DD')
  const lunarMonth = calendar.format(key, 'lM')
  return `${month + 1}月（${lunarMonth}）`
}

function findCellCaption(date: Dayjs): { text: string; isFestival: boolean } {
  const key = timeSphere.format(date.toDate(), 'YYYY-MM-DD')
  const legal = calendar.legalHoliday(key)?.name
  if (legal) return { text: legal, isFestival: true }
  const festival = calendar.festival(key)
  if (festival) return { text: festival, isFestival: true }
  const term = calendar.term(key)
  if (term) return { text: term, isFestival: true }
  return { text: calendar.format(key, 'lD'), isFestival: false }
}

/** 定位到目标月份的同一天，日期越界时收敛到月末 */
function findMonthDate(panelDate: Dayjs, month: number, dayOfMonth: number): Dayjs {
  const target = panelDate.startOf('month').month(month)
  return target.date(Math.min(dayOfMonth, target.daysInMonth()))
}

function findYearOptions(year: number) {
  const options: { label: string; value: number }[] = []
  for (let i = year - 10; i < year + 10; i += 1) {
    options.push({ label: findYearLabel(i), value: i })
  }
  return options
}

function findMonthOptions(value: Dayjs) {
  const options: { label: string; value: number }[] = []
  for (let i = 0; i < MONTH_COUNT; i += 1) {
    options.push({ label: findMonthLabel(i, value), value: i })
  }
  return options
}

function DayGrid(props: DayGridProps) {
  const { selectDate, panelDate, markedDates, onSelectDate, onPanelDate } = props
  const [panelMode, onUpdatePanelMode] = useState<PanelMode>('month')

  const today = dayjs()
  const weekStart = panelDate.startOf('week')
  const weekdayCells = Array.from({ length: COLUMN_COUNT }, function (_item, index) {
    const weekday = weekStart.add(index, 'day').day()
    return {
      key: weekday,
      label: WEEKDAY_LABELS[weekday],
      isWeekend: weekday === 0 || weekday === 6
    }
  })

  const gridStart = panelDate.startOf('month').startOf('week')
  const days: Dayjs[] = []
  for (let index = 0; index < ROW_COUNT * COLUMN_COUNT; index += 1) {
    days.push(gridStart.add(index, 'day'))
  }

  const yearOptions = findYearOptions(panelDate.year())
  const monthOptions = findMonthOptions(panelDate)

  function changeYear(nextYear: number) {
    onPanelDate(panelDate.startOf('month').year(nextYear))
  }

  function changeMonth(nextMonth: number) {
    onPanelDate(panelDate.startOf('month').month(nextMonth))
  }

  function changePanelMode(nextMode: PanelMode | null) {
    if (nextMode) onUpdatePanelMode(nextMode)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <Select
            value={panelDate.year()}
            items={yearOptions}
            onValueChange={function (value) {
              if (value === null) return
              changeYear(value)
            }}>
            <SelectTrigger
              size="sm"
              className="w-fit"
              aria-label="选择年份">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map(function (option) {
                return (
                  <SelectItem
                    key={option.value}
                    value={option.value}>
                    {option.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Select
            value={panelDate.month()}
            items={monthOptions}
            onValueChange={function (value) {
              if (value === null) return
              changeMonth(value)
            }}>
            <SelectTrigger
              size="sm"
              className="w-fit"
              aria-label="选择月份">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map(function (option) {
                return (
                  <SelectItem
                    key={option.value}
                    value={option.value}>
                    {option.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <div className={styles.toolbarRight}>
          <ToggleGroup
            size="sm"
            variant="outline"
            spacing={0}
            value={[panelMode]}
            onValueChange={function (value) {
              changePanelMode((value[0] as PanelMode) ?? null)
            }}>
            <ToggleGroupItem
              value="month"
              className="data-[pressed]:bg-primary/10 data-[pressed]:text-primary">
              月
            </ToggleGroupItem>
            <ToggleGroupItem
              value="year"
              className="data-[pressed]:bg-primary/10 data-[pressed]:text-primary">
              年
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {panelMode === 'month' ? (
        <>
          <div className={styles.weekRow}>
            {weekdayCells.map(function (cell) {
              return (
                <div
                  key={cell.key}
                  className={clsx(styles.weekCell, cell.isWeekend && styles.weekCellWeekend)}>
                  {cell.label}
                </div>
              )
            })}
          </div>
          <div className={styles.grid}>
            {days.map(function (date) {
              const key = timeSphere.format(date.toDate(), 'YYYY-MM-DD')
              const caption = findCellCaption(date)
              const isWeekend = date.day() === 6 || date.day() === 0
              const isCurrent = selectDate.isSame(date, 'date')
              const isToday = date.isSame(today, 'date')
              const isOutside = !panelDate.isSame(date, 'month')
              const hasMark = markedDates.has(key)

              return (
                <button
                  key={key}
                  type="button"
                  aria-label={key}
                  aria-current={isCurrent ? 'date' : undefined}
                  className={clsx(styles.dateCell, {
                    [styles.current]: isCurrent,
                    [styles.today]: isToday && !isCurrent,
                    [styles.outside]: isOutside && !isCurrent
                  })}
                  onClick={function () {
                    onSelectDate(date)
                  }}>
                  <span className={styles.text}>
                    <span className={clsx(styles.dayNum, isWeekend && styles.weekend)}>
                      {date.date()}
                    </span>
                    <span className={clsx(styles.lunar, caption.isFestival && styles.festival)}>
                      {caption.text}
                    </span>
                    <span
                      className={styles.markSlot}
                      aria-hidden={!hasMark}>
                      {hasMark ? (
                        <span className={clsx(styles.mark, isCurrent && styles.markOnCurrent)} />
                      ) : null}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div className={styles.yearGrid}>
          {monthOptions.map(function (option) {
            const date = panelDate.startOf('year').month(option.value)
            const lunarMonth = calendar.format(
              timeSphere.format(new Date(date.year(), option.value, 15), 'YYYY-MM-DD'),
              'lM'
            )
            const isCurrent = selectDate.isSame(date, 'month') && selectDate.isSame(date, 'year')
            const isThisMonth = today.isSame(date, 'month') && today.isSame(date, 'year')

            return (
              <button
                key={option.value}
                type="button"
                aria-label={`${date.year()}年${option.value + 1}月`}
                aria-current={isCurrent ? 'date' : undefined}
                className={clsx(styles.monthCell, {
                  [styles.monthCellCurrent]: isCurrent,
                  [styles.monthCellToday]: isThisMonth && !isCurrent
                })}
                onClick={function () {
                  onSelectDate(findMonthDate(panelDate, option.value, selectDate.date()))
                }}>
                <span className={styles.monthText}>
                  <span className={styles.monthPrimary}>
                    <span className={styles.monthNum}>{option.value + 1}</span>
                    <span className={styles.monthUnit}>月</span>
                  </span>
                  <span className={styles.monthLunar}>{lunarMonth}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { DayGrid }
export type { DayGridProps }
