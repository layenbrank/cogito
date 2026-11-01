import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShellSurface } from '@/features/window-shell/slots'
import CalendarView from '@/views/calendar/calendar-view.tsx'

export default function Calendar() {
  useShellSurface({
    summary: findComponentLabel('calendar'),
    scrollable: false
  })

  return (
    <div className="mt-stage">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CalendarView />
      </div>
    </div>
  )
}
