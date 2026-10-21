import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import styles from '@/views/signboard/signboard.module.scss'

type ViewMode = 'board' | 'table' | 'gantt' | 'calendar' | 'stats' | 'workload'

interface ViewTab {
  id: ViewMode
  label: string
  icon: string
}

const VIEW_TABS: ViewTab[] = [
  { id: 'board', label: '看板', icon: 'lucide:columns-3' },
  { id: 'table', label: '表格', icon: 'lucide:table' },
  { id: 'gantt', label: '甘特', icon: 'lucide:chart-gantt' },
  { id: 'calendar', label: '日历', icon: 'lucide:calendar' },
  { id: 'stats', label: '统计', icon: 'lucide:chart-column' },
  { id: 'workload', label: '工作量', icon: 'lucide:gauge' }
]

interface ViewTabsProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}

function ViewTabs(props: ViewTabsProps) {
  return (
    <div
      className={styles.viewTabs}
      role="tablist"
      aria-label="看板视图">
      {VIEW_TABS.map(function (tab) {
        const isActive = props.value === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={clsx(styles.viewTab, isActive && styles.viewTabActive)}
            onClick={function () {
              props.onChange(tab.id)
            }}>
            <Icon
              icon={tab.icon}
              className="size-3.5"
              aria-hidden
            />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export { ViewTabs, VIEW_TABS }
export type { ViewMode }
