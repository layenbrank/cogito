import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { useCodeStore } from '@/stores/code'
import Navigation from '@/views/code/workspace/overlay/navigation.tsx'
import { ScmSurface } from '@/views/code/workspace/scm/surface.tsx'
import { SearchSurface } from '@/views/code/workspace/search/surface.tsx'

function SidebarHeader(props: { title: string; children?: ReactNode }) {
  return (
    <div className="border-border/60 text-muted-foreground flex h-7 shrink-0 items-center gap-2 px-3 text-xs font-semibold tracking-wider uppercase">
      <span className="truncate">{props.title}</span>
      {props.children ? (
        <div className="ml-auto flex shrink-0 items-center gap-0.5">{props.children}</div>
      ) : null}
    </div>
  )
}

/** 工具栏图标按钮：保持 20px 口径，和标题同高 */
function HeaderAction(props: { icon: string; label: string; isActive?: boolean; onClick(): void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      aria-label={props.label}
      aria-pressed={props.isActive}
      title={props.label}
      className={cn(
        'hover:bg-muted hover:text-foreground flex size-5 items-center justify-center rounded-sm',
        props.isActive && 'text-primary'
      )}
      onClick={function () {
        props.onClick()
      }}>
      <Icon
        icon={props.icon}
        className="size-3.5"
      />
    </Button>
  )
}

function Sidebar() {
  const sidebarView = useCodeStore(function (state) {
    return state.sidebarView
  })
  const isSidebarOpen = useCodeStore(function (state) {
    return state.isSidebarOpen
  })
  const isHiddenVisible = useCodeStore(function (state) {
    return state.isHiddenVisible
  })

  if (!isSidebarOpen) return null

  // 搜索面板自带标题栏（刷新 / 清除 / 折叠），避免与通用 Header 叠两层
  if (sidebarView === 'search') {
    return (
      <aside
        className={cn(
          'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-border/50 bg-background/65 backdrop-blur-md'
        )}>
        <SearchSurface />
      </aside>
    )
  }

  const title = sidebarView === 'explorer' ? '资源管理器' : '源代码管理'

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-border/50 bg-background/65 backdrop-blur-md'
      )}>
      <SidebarHeader title={title}>
        {sidebarView === 'explorer' ? (
          <>
            <HeaderAction
              icon="lucide:refresh-cw"
              label="刷新"
              onClick={function () {
                useCodeStore.getState().toBumpTree()
              }}
            />
            <HeaderAction
              icon="lucide:fold-vertical"
              label="折叠全部"
              onClick={function () {
                useCodeStore.getState().toCollapseAll()
              }}
            />
            <HeaderAction
              icon={isHiddenVisible ? 'lucide:eye' : 'lucide:eye-off'}
              label={isHiddenVisible ? '隐藏隐藏文件' : '显示隐藏文件'}
              isActive={isHiddenVisible}
              onClick={function () {
                useCodeStore.getState().toToggleHiddenVisible()
              }}
            />
          </>
        ) : null}
      </SidebarHeader>
      <div className="min-h-0 flex-1 overflow-hidden">
        {sidebarView === 'explorer' ? <Navigation /> : null}
        {sidebarView === 'scm' ? <ScmSurface /> : null}
      </div>
    </aside>
  )
}

export { Sidebar }
