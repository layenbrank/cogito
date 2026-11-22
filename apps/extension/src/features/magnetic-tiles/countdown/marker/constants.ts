import type { WorkStatus } from '@/features/magnetic-tiles/countdown/compute'

/** Lucide 线标：企业级克制，与自研磁贴统一 */
const STATUS_ICON: Record<WorkStatus, string> = {
  before: 'lucide:alarm-clock',
  working: 'lucide:briefcase',
  after: 'lucide:circle-check',
  rest: 'lucide:house'
}

const METRIC_ICON = {
  earn: 'lucide:wallet',
  countdown: 'lucide:timer',
  payday: 'lucide:calendar-check',
  status: 'lucide:circle-check',
  progress: 'lucide:chart-no-axes-column',
  shift: 'lucide:clock-3',
  decor: 'lucide:briefcase'
} as const

export { STATUS_ICON, METRIC_ICON }
