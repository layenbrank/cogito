import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'

import {
  buildYearCells,
  findDecadeStart,
  isDateDisabled,
  isInRange,
  isRangeEdge
} from './calendar-math'
import { CellButton } from './cell-button'
import { isSamePicker } from './format'
import type { DateBounds } from './types'

interface YearSurfaceProps {
  cursor: Dayjs
  selected?: Dayjs | null
  rangeStart?: Dayjs | null
  rangeEnd?: Dayjs | null
  hoverDate?: Dayjs | null
  bounds: DateBounds
  onSelect: (date: Dayjs) => void
  onHover?: (date: Dayjs | null) => void
}

function YearSurface(props: YearSurfaceProps) {
  const years = buildYearCells(props.cursor.year())
  const decadeStart = findDecadeStart(props.cursor.year())
  const previewEnd = props.rangeEnd ?? props.hoverDate

  return (
    <div className="grid grid-cols-3 gap-1 p-2.5">
      {years.map(function (cell) {
        const yearDate = dayjs().year(cell.year).startOf('year')
        const isSelected = isSamePicker(props.selected, yearDate, 'year')
        const edge = isRangeEdge(yearDate, props.rangeStart, previewEnd, 'year')
        const isRange =
          !!props.rangeStart &&
          !!previewEnd &&
          isInRange(yearDate, props.rangeStart, previewEnd, 'year')
        const isToday = yearDate.isSame(new Date(), 'year')

        return (
          <CellButton
            key={cell.year}
            label={String(cell.year)}
            isSelected={isSelected}
            isToday={isToday && !isSelected}
            isOutside={cell.isOutside}
            isDisabled={isDateDisabled(yearDate, 'year', props.bounds)}
            isInRange={isRange && !edge}
            isRangeStart={edge === 'start'}
            isRangeEnd={edge === 'end'}
            className="h-9 w-full min-w-0"
            onClick={function () {
              props.onSelect(yearDate)
            }}
            onMouseEnter={function () {
              props.onHover?.(yearDate)
            }}>
            {cell.year}
          </CellButton>
        )
      })}
      <span className="sr-only">
        {decadeStart}–{decadeStart + 9}
      </span>
    </div>
  )
}

export { YearSurface }
