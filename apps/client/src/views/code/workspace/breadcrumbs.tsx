import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'

import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { findFileName, findPathSegments, findRelativePath } from '@/views/code/lib/path.ts'

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
  const branch = useCodeGitStore(function (state) {
    return state.branch
  })

  const activeTab = tabs.find(function (tab) {
    return tab.id === activeTabId
  })

  if (!activeTab) return null

  if (activeTab.kind === 'commits') {
    const rootName = workspaceRoot ? findFileName(workspaceRoot) : '仓库'
    return (
      <nav
        aria-label="面包屑"
        className={cn(
          'flex h-5.5 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 bg-background/80 px-3 text-xs text-muted-foreground backdrop-blur-sm'
        )}>
        <Icon
          icon="lucide:git-commit-horizontal"
          className="text-primary size-3 shrink-0"
        />
        <span className="text-foreground/90 truncate">{rootName}</span>
        <Icon
          icon="lucide:chevron-right"
          className="size-3 shrink-0 opacity-40"
        />
        <span className="text-foreground/90 shrink-0">提交</span>
        {branch ? (
          <>
            <Icon
              icon="lucide:chevron-right"
              className="size-3 shrink-0 opacity-40"
            />
            <span
              className="flex min-w-0 items-center gap-1 truncate"
              title={branch}>
              <Icon
                icon="lucide:git-branch"
                className="size-3 shrink-0 opacity-70"
              />
              <span className="truncate">{branch}</span>
            </span>
          </>
        ) : null}
      </nav>
    )
  }

  const relative = workspaceRoot
    ? findRelativePath(workspaceRoot, activeTab.path)
    : activeTab.title
  const segments = findPathSegments(relative)

  if (segments.length === 0) return null

  return (
    <nav
      aria-label="面包屑"
      className={cn(
        'flex h-5.5 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/50 bg-background/80 px-3 text-xs text-muted-foreground backdrop-blur-sm'
      )}>
      {segments.map(function (segment, index) {
        const isLast = index === segments.length - 1
        // 同名目录可能在路径里重复（a/b/a），用累积路径做 key 才唯一
        const segmentKey = segments.slice(0, index + 1).join('/')
        return (
          <span
            key={segmentKey}
            className="flex min-w-0 shrink-0 items-center gap-0.5">
            {index > 0 ? (
              <Icon
                icon="lucide:chevron-right"
                className="size-3 shrink-0 opacity-40"
              />
            ) : null}
            {isLast ? (
              <span
                className="text-foreground/90 max-w-48 truncate"
                title={
                  activeTab.kind === 'diff'
                    ? activeTab.headOid
                      ? `${segment} · ${(activeTab.baseOid || '∅').slice(0, 7)} ↔ ${activeTab.headOid.slice(0, 7)}`
                      : `${segment} · HEAD ↔ 工作区`
                    : segment
                }>
                {segment}
                {activeTab.kind === 'diff' ? (
                  <span className="text-muted-foreground ml-1 font-normal">
                    ({activeTab.headOid ? activeTab.headOid.slice(0, 7) : '工作区'})
                  </span>
                ) : null}
              </span>
            ) : (
              <Button
                variant="ghost"
                type="button"
                className="hover:text-foreground hover:bg-muted/60 h-auto max-w-40 cursor-pointer truncate rounded-sm px-0.5"
                title={`在资源管理器中打开 ${segmentKey}`}
                onClick={function () {
                  const store = useCodeStore.getState()
                  store.toSetSidebarView('explorer')
                  if (!store.isSidebarOpen) store.toToggleSidebar()
                  store.toRevealPath(segmentKey)
                }}>
                {segment}
              </Button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export { Breadcrumbs }
