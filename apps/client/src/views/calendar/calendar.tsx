import { lazy, Suspense } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'

const CalendarView = lazy(function () {
  return import('@/views/calendar/calendar-view.tsx')
})

export default function Calendar() {
  return (
    <Decorations
      summary={findComponentLabel('calendar')}
      scrollable={false}>
      <div className="mt-stage">
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          }>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <CalendarView />
          </div>
        </Suspense>
      </div>
    </Decorations>
  )
}
