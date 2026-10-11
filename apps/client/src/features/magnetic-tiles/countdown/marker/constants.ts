import type { WorkStatus } from '@/features/magnetic-tiles/countdown/compute'

const STATUS_ICON: Record<WorkStatus, string> = {
  before: 'mdi:briefcase-clock-outline',
  working: 'mdi:briefcase-check-outline',
  after: 'mdi:home-clock-outline',
  rest: 'mdi:beach'
}

const METRIC_ICON = {
  earn: 'mdi:cash-multiple',
  countdown: 'mdi:timer-outline',
  payday: 'mdi:calendar-star',
  status: 'mdi:checkbox-marked-circle-outline',
  progress: 'mdi:chart-timeline-variant',
  shift: 'mdi:clock-outline',
  decor: 'mdi:briefcase-clock-outline'
} as const

export { STATUS_ICON, METRIC_ICON }
