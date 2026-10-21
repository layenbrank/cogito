import type { Dayjs } from 'dayjs'

import { buildMonthCells, isDateDisabled, isInRange, isRangeEdge, MONTHS } from './calendar-math'
import { CellButton } from './cell-button'
import { isSamePicker } from './format'
import type { DateBounds } from './types'

interface MonthSurfaceProps {
  cursor: Dayjs
  selected?: Dayjs | null
  rangeStart?: Dayjs | null
  rangeEnd?: Dayjs | null
  hoverDate?: Dayjs | null
  bounds: DateBounds
  onSelect: (date: Dayjs) => void
  onHover?: (date: Dayjs | null) => void
}

function MonthSurface(props: MonthSurfaceProps) {
  const months = buildMonthCells(props.cursor.year())
  const previewEnd = props.rangeEnd ?? props.hoverDate

  return (
    <div className="grid grid-cols-3 gap-1 p-2.5">
      {months.map(function (monthDate, index) {
        const isSelected = isSamePicker(props.selected, monthDate, 'month')
        const edge = isRangeEdge(monthDate, props.rangeStart, previewEnd, 'month')
        const isRange =
          !!props.rangeStart &&
          !!previewEnd &&
          isInRange(monthDate, props.rangeStart, previewEnd, 'month')
        const isToday = monthDate.isSame(new Date(), 'month')

        return (
          <CellButton
            key={monthDate.format('YYYY-MM')}
            label={monthDate.format('YYYY-MM')}
            isSelected={isSelected}
            isToday={isToday && !isSelected}
            isDisabled={isDateDisabled(monthDate, 'month', props.bounds)}
            isInRange={isRange && !edge}
            isRangeStart={edge === 'start'}
            isRangeEnd={edge === 'end'}
            className="h-9 w-full min-w-0"
            onClick={function () {
              props.onSelect(monthDate)
            }}
            onMouseEnter={function () {
              props.onHover?.(monthDate)
            }}>
            {MONTHS[index]}
          </CellButton>
        )
      })}
    </div>
  )
}

export { MonthSurface }
