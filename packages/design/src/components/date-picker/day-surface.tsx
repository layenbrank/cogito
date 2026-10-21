import type { Dayjs } from 'dayjs'

import { buildDayCells, isDateDisabled, isInRange, isRangeEdge, WEEKDAYS } from './calendar-math'
import { CellButton } from './cell-button'
import { isSamePicker } from './format'
import type { DateBounds, PickerKind } from './types'

interface DaySurfaceProps {
  cursor: Dayjs
  picker?: PickerKind
  selected?: Dayjs | null
  rangeStart?: Dayjs | null
  rangeEnd?: Dayjs | null
  hoverDate?: Dayjs | null
  bounds: DateBounds
  onSelect: (date: Dayjs) => void
  onHover?: (date: Dayjs | null) => void
}

function DaySurface(props: DaySurfaceProps) {
  const picker: PickerKind = props.picker ?? 'date'
  const cells = buildDayCells(props.cursor)
  const previewEnd = props.rangeEnd ?? props.hoverDate

  return (
    <div className="space-y-1.5 p-2.5">
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map(function (weekday) {
          return (
            <div
              key={weekday}
              className="flex h-8 items-center justify-center text-xs font-medium text-muted-foreground">
              {weekday}
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map(function (cell) {
          const isSelected = isSamePicker(props.selected, cell.date, 'date')
          const edge = isRangeEdge(cell.date, props.rangeStart, previewEnd, 'date')
          const isRange =
            !!props.rangeStart &&
            !!previewEnd &&
            isInRange(cell.date, props.rangeStart, previewEnd, 'date')
          const isToday = cell.date.isSame(new Date(), 'day')

          return (
            <CellButton
              key={cell.date.format('YYYY-MM-DD')}
              label={cell.date.format('YYYY-MM-DD')}
              isSelected={isSelected}
              isToday={isToday}
              isOutside={cell.isOutside}
              isDisabled={isDateDisabled(cell.date, picker, props.bounds)}
              isInRange={isRange && !edge}
              isRangeStart={edge === 'start'}
              isRangeEnd={edge === 'end'}
              onClick={function () {
                props.onSelect(cell.date)
              }}
              onMouseEnter={function () {
                props.onHover?.(cell.date)
              }}>
              {cell.date.date()}
            </CellButton>
          )
        })}
      </div>
    </div>
  )
}

export { DaySurface }
