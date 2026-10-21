import { cn } from 'cn'
import type { Dayjs } from 'dayjs'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { useAppReducedMotion } from '@i-thinking/design/hooks/use-app-reduced-motion'
import { DIGIT_TRANSITION, EASE_OUT } from '@i-thinking/design/lib/motion'

import { shiftCursor } from './calendar-math'
import { DaySurface } from './day-surface'
import { MonthSurface } from './month-surface'
import { SurfaceHeader } from './surface-header'
import type { DateBounds, PickerKind, SurfaceMode } from './types'
import { YearSurface } from './year-surface'

interface SurfaceBodyProps {
  picker: PickerKind
  mode: SurfaceMode
  cursor: Dayjs
  slideDir: 1 | -1
  selected?: Dayjs | null
  rangeStart?: Dayjs | null
  rangeEnd?: Dayjs | null
  hoverDate?: Dayjs | null
  bounds: DateBounds
  onModeChange: (mode: SurfaceMode) => void
  onCursorChange: (cursor: Dayjs, dir: 1 | -1) => void
  onSelectDate: (date: Dayjs) => void
  onSelectMonth: (date: Dayjs) => void
  onSelectYear: (date: Dayjs) => void
  onHover?: (date: Dayjs | null) => void
  children?: ReactNode
}

function SurfaceBody(props: SurfaceBodyProps) {
  const isReduced = useAppReducedMotion()

  function handleTitleClick() {
    if (props.mode === 'date') props.onModeChange('month')
    else if (props.mode === 'month') props.onModeChange('year')
  }

  function handlePrev() {
    const next = shiftCursor(props.cursor, props.mode === 'date' ? 'date' : props.mode, -1)
    props.onCursorChange(next, -1)
  }

  function handleNext() {
    const next = shiftCursor(props.cursor, props.mode === 'date' ? 'date' : props.mode, 1)
    props.onCursorChange(next, 1)
  }

  /** 仅 mode 切换时换层；翻月/年靠格子内数字动画，避免整层再滑一次 */
  const surfaceKey = props.mode

  return (
    <div className="flex flex-col">
      <SurfaceHeader
        mode={props.mode}
        year={props.cursor.year()}
        month={props.cursor.month() + 1}
        slideDir={props.slideDir}
        onPrev={handlePrev}
        onNext={handleNext}
        onTitleClick={handleTitleClick}
      />
      <div className="relative overflow-hidden">
        <AnimatePresence
          mode="wait"
          initial={false}>
          <motion.div
            key={surfaceKey}
            initial={isReduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={isReduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={isReduced ? { duration: 0 } : { ...DIGIT_TRANSITION, ease: EASE_OUT }}
            className={cn(!isReduced && 'will-change-transform')}>
            {props.mode === 'date' ? (
              <DaySurface
                cursor={props.cursor}
                picker={props.picker}
                selected={props.selected}
                rangeStart={props.rangeStart}
                rangeEnd={props.rangeEnd}
                hoverDate={props.hoverDate}
                bounds={props.bounds}
                onSelect={props.onSelectDate}
                onHover={props.onHover}
              />
            ) : null}
            {props.mode === 'month' ? (
              <MonthSurface
                cursor={props.cursor}
                selected={props.selected}
                rangeStart={props.rangeStart}
                rangeEnd={props.rangeEnd}
                hoverDate={props.hoverDate}
                bounds={props.bounds}
                onSelect={props.onSelectMonth}
                onHover={props.onHover}
              />
            ) : null}
            {props.mode === 'year' ? (
              <YearSurface
                cursor={props.cursor}
                selected={props.selected}
                rangeStart={props.rangeStart}
                rangeEnd={props.rangeEnd}
                hoverDate={props.hoverDate}
                bounds={props.bounds}
                onSelect={props.onSelectYear}
                onHover={props.onHover}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
      {props.children}
    </div>
  )
}

export { SurfaceBody }
