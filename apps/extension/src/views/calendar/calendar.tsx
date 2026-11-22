import CalendarView from '@/views/calendar/calendar-view.tsx'

export default function Calendar() {
  return (
    <div className="mt-stage">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CalendarView />
      </div>
    </div>
  )
}
