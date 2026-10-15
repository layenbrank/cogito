import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import { useCodeStore } from '@/stores/code'
import { findPathSegments, findRelativePath } from '@/views/code/lib/path.ts'

function Breadcrumbs() {
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })

  const activeTab = tabs.find(function (tab) {
    return tab.id === activeTabId
  })

  if (!activeTab) return null

  const relative = workspaceRoot
    ? findRelativePath(workspaceRoot, activeTab.path)
    : activeTab.title
  const segments = findPathSegments(relative)

  if (segments.length === 0) return null

  return (
    <nav
      aria-label="面包屑"
      className={cn(
        'flex h-[22px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/50 bg-background/80 px-3 text-[11px] text-muted-foreground backdrop-blur-sm'
      )}>
      {segments.map(function (segment, index) {
        const isLast = index === segments.length - 1
        return (
          <span
            key={`${segment}-${index}`}
            className="flex min-w-0 shrink-0 items-center gap-0.5">
            {index > 0 ? (
              <Icon
                icon="lucide:chevron-right"
                className="size-3 shrink-0 opacity-40"
              />
            ) : null}
            <span
              className={cn(
                'max-w-40 truncate',
                isLast ? 'text-foreground/90' : 'hover:text-foreground'
              )}
              title={segment}>
              {segment}
            </span>
          </span>
        )
      })}
    </nav>
  )
}

export { Breadcrumbs }
