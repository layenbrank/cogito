/**
 * 左内容栏：文档 | 文件 + 底部活动条。
 * 避免 Button 默认 focus ring 撑破分段控件；文件树区域必须吃满剩余高度。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useState } from 'react'

import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { ActivityCompact } from '@/views/knowledge/surface/activity-compact.tsx'
import { DocsTab } from '@/views/knowledge/surface/docs.tsx'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'
import { Overlay } from '@/views/knowledge/workspace/overlay/index.ts'

type SidebarMode = 'knowledge' | 'files'

function SidebarPanel() {
  const [mode, setMode] = useState<SidebarMode>('knowledge')
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
      <div
        role="tablist"
        aria-label="侧栏视图"
        className="bg-muted/55 m-2.5 grid shrink-0 grid-cols-2 gap-0.5 rounded-lg p-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'knowledge'}
          className={cn(
            'h-7 rounded-md text-xs font-medium transition-colors outline-none',
            'focus-visible:ring-1 focus-visible:ring-ring/40',
            mode === 'knowledge'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={function () {
            setMode('knowledge')
          }}>
          文档
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'files'}
          className={cn(
            'h-7 rounded-md text-xs font-medium transition-colors outline-none',
            'focus-visible:ring-1 focus-visible:ring-ring/40',
            mode === 'files'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={function () {
            setMode('files')
          }}>
          文件
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mode === 'knowledge' ? (
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

export { SidebarPanel }
