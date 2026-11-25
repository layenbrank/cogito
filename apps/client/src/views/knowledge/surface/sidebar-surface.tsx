/**
 * 左栏（唯一一条侧栏）：顶部空间切换 + 文档/文件 + 底部活动条。
 * 不再有 48px 图标 rail——知识库工具都收进标题栏菜单。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useState } from 'react'

import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { ActivityCompact } from '@/views/knowledge/surface/activity-compact.tsx'
import { DocsTab } from '@/views/knowledge/surface/docs.tsx'
import {
  SpaceSwitcher,
  type SidebarMode
} from '@/views/knowledge/surface/space-switcher.tsx'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'
import { Overlay } from '@/views/knowledge/workspace/overlay/index.ts'

function SidebarSurface() {
  const [mode, setMode] = useState<SidebarMode>('docs')
  const ingestPending = useIngestQueueStore(function (state) {
    return state.items.filter(function (item) {
      return item.status === 'pending' || item.status === 'running' || item.status === 'blocked'
    }).length
  })
  const [isActivityOpen, setActivityOpen] = useState(function () {
    return ingestPending > 0
  })

  return (
    <div className="bg-card flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <SpaceSwitcher
        mode={mode}
        onModeChange={setMode}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mode === 'docs' ? (
          <div className="flex min-h-0 flex-1 flex-col px-2 pb-1">
            <DocsTab />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Overlay.Navigation
              embedded
              onOpenPath={openEditorPath}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border">
        <button
          type="button"
          className={cn(
            'text-muted-foreground hover:bg-muted/45 hover:text-foreground',
            'flex h-8 w-full items-center justify-between px-2.5 text-xs font-medium outline-none',
            'focus-visible:bg-muted/50 transition-colors'
          )}
          onClick={function () {
            setActivityOpen(!isActivityOpen)
          }}>
          <span className="inline-flex items-center gap-1.5">
            <Icon
              icon="lucide:list-checks"
              className="size-3.5 opacity-70"
            />
            活动
            {ingestPending > 0 ? (
              <span className="bg-primary/15 text-primary rounded px-1 py-px text-[10px] font-semibold tabular-nums">
                {ingestPending}
              </span>
            ) : null}
          </span>
          <Icon
            icon={isActivityOpen ? 'lucide:chevron-down' : 'lucide:chevron-up'}
            className="size-3.5 opacity-50"
          />
        </button>
        {isActivityOpen ? (
          <div className="max-h-40 min-h-0 overflow-hidden border-t border-border/40 px-2 py-1.5">
            <ActivityCompact />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { SidebarSurface }
