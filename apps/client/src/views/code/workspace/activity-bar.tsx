import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { cn } from 'cn'

import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore, type SidebarView } from '@/stores/code'
import { findBindingText } from '@/views/code/lib/bindings.ts'

interface ActivityItem {
  view: SidebarView
  icon: string
  label: string
}

const ACTIVITIES: ActivityItem[] = [
  { view: 'explorer', icon: 'lucide:files', label: '资源管理器' },
  { view: 'search', icon: 'lucide:search', label: '搜索' },
  { view: 'scm', icon: 'lucide:git-branch', label: '源代码管理' }
]

function ActivityBar() {
  const sidebarView = useCodeStore(function (state) {
    return state.sidebarView
  })
  const isSidebarOpen = useCodeStore(function (state) {
    return state.isSidebarOpen
  })
  const isRepo = useCodeGitStore(function (state) {
    return state.isRepo
  })
  const changeCount = useCodeGitStore(function (state) {
    return state.entries.length
  })

  return (
    <nav
      aria-label="活动栏"
      className="flex w-12 shrink-0 flex-col items-center gap-0 border-r border-border/50 bg-background/60 py-1 backdrop-blur-md">
      {ACTIVITIES.map(function (item) {
        const isActive = isSidebarOpen && sidebarView === item.view
        const badge =
          item.view === 'scm' && isRepo && changeCount > 0
            ? changeCount > 99
              ? '99+'
              : String(changeCount)
            : null
        return (
          <Tooltip key={item.view}>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={
                    badge ? `${item.label}，${changeCount} 项更改` : item.label
                  }
                  aria-pressed={isActive}
                  className={cn(
                    'relative size-10 rounded-none border-0 shadow-none ring-0 focus-visible:ring-1 focus-visible:ring-ring/30',
                    isActive
                      ? 'bg-muted text-foreground hover:bg-muted hover:text-foreground'
                      : 'text-muted-foreground/55 hover:bg-transparent hover:text-foreground/80'
                  )}
                  onClick={function () {
                    useCodeStore.getState().toToggleSidebarView(item.view)
                  }}
                />
              }>
              <Icon
                icon={item.icon}
                className="size-5"
              />
              {badge ? (
                <span className="bg-primary text-primary-foreground absolute top-1 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] leading-none font-medium">
                  {badge}
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={6}>
              <span>{item.label}</span>
              <span className="text-background/70 ml-2">
                {findBindingText('CODE_TOGGLE_SIDEBAR')}
              </span>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </nav>
  )
}

export { ActivityBar }
