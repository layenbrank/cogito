/**
 * 闹钟 / 提醒 provider
 */
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { openComponentRoute } from '@/features/command-bar/open-route'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import { useReminderStore } from '@/stores/reminder'

function searchReminder(query: string): Hit[] {
  const reminders = useReminderStore.getState().reminders
  const normalized = query.trim().toLowerCase()
  const filtered = normalized
    ? reminders.filter(function (item) {
        const haystack = `${item.title} ${item.notes}`.toLowerCase()
        return haystack.includes(normalized)
      })
    : reminders

  return filtered.slice(0, OMNIBAR_UI.LOCAL_LIMIT).map(function (item, index) {
    return {
      domain: 'reminder' as const,
      id: item.id,
      title: item.title || '未命名提醒',
      subtitle: item.fireTime || item.notes || '闹钟',
      score: 1 - index * 0.01,
      icon: 'lucide:alarm-clock',
      async run() {
        await openComponentRoute('clock', { id: item.id })
      }
    }
  })
}

const reminderProvider: SearchProvider = {
  domain: 'reminder',
  search(query) {
    return searchReminder(query)
  }
}

export { reminderProvider }
