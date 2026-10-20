/**
 * 日历日程 provider
 */
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { openComponentRoute } from '@/features/command-bar/open-route'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import { useCalendarStore } from '@/stores/calendar'

function searchCalendar(query: string): Hit[] {
  const events = useCalendarStore.getState().events
  const normalized = query.trim().toLowerCase()
  const filtered = normalized
    ? events.filter(function (event) {
        const haystack = `${event.title} ${event.notes}`.toLowerCase()
        return haystack.includes(normalized)
      })
    : events

  return filtered.slice(0, OMNIBAR_UI.LOCAL_LIMIT).map(function (event, index) {
    const when = new Date(event.startAt).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    return {
      domain: 'calendar' as const,
      id: event.id,
      title: event.title || '未命名日程',
      subtitle: when,
      score: 1 - index * 0.01,
      icon: 'lucide:calendar',
      async run() {
        await openComponentRoute('calendar', { id: event.id })
      }
    }
  })
}

const calendarProvider: SearchProvider = {
  domain: 'calendar',
  search(query) {
    return searchCalendar(query)
  }
}

export { calendarProvider }
