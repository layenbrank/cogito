import { Icon } from '@iconify/react/offline'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'

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

interface ViewModeSelectProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}

function findViewTab(mode: ViewMode) {
  return (
    VIEW_TABS.find(function (tab) {
      return tab.id === mode
    }) ?? VIEW_TABS[0]
  )
}

function ViewModeSelect(props: ViewModeSelectProps) {
  const active = findViewTab(props.value)

  return (
    <Select
      items={VIEW_TABS.map(function (tab) {
        return { value: tab.id, label: tab.label }
      })}
      value={props.value}
      onValueChange={function (value) {
        if (value === null) return
        props.onChange(value)
      }}>
      <SelectTrigger
        size="sm"
        className="h-8 w-[7.5rem]"
        aria-label="视图">
        <SelectValue>
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon
              icon={active.icon}
              className="size-3.5 shrink-0"
              aria-hidden
            />
            <span className="truncate">{active.label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {VIEW_TABS.map(function (tab) {
          return (
            <SelectItem
              key={tab.id}
              value={tab.id}>
              <span className="flex items-center gap-1.5">
                <Icon
                  icon={tab.icon}
                  className="size-3.5 shrink-0"
                  aria-hidden
                />
                {tab.label}
              </span>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

/** @deprecated 使用 ViewModeSelect；保留别名以免外部误引用 */
const ViewTabs = ViewModeSelect

export { ViewModeSelect, ViewTabs, VIEW_TABS }
export type { ViewMode }
