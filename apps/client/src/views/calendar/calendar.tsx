import { lazy, Suspense } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import styles from '@/views/calendar/calendar.module.scss'

const CalendarView = lazy(function () {
  return import('@/views/calendar/calendar-view.tsx')
})

export default function Calendar() {
  return (
    <Decorations
      summary={findComponentLabel('calendar')}
      scrollable={false}>
      <div className={styles.stage}>
        <Suspense fallback={<div className={styles.fallback}>加载中…</div>}>
          <div className={styles.view}>
            <CalendarView />
          </div>
        </Suspense>
      </div>
    </Decorations>
  )
}
