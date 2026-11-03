/**
 * 左内容栏：对齐 llm_wiki SidebarPanel（Knowledge | Files）+ 底部 Activity 条。
 */
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import { useState } from 'react'

import { ActivityTab } from '@/views/knowledge/surface/activity.tsx'
import { DocsTab } from '@/views/knowledge/surface/docs.tsx'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'
import { Overlay } from '@/views/knowledge/workspace/overlay/index.ts'

type SidebarMode = 'knowledge' | 'files'

function SidebarPanel() {
  const [mode, setMode] = useState<SidebarMode>('knowledge')
  const [isActivityOpen, setActivityOpen] = useState(true)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 border-b border-border">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            'h-8 flex-1 rounded-none border-b-2 border-transparent text-xs font-medium',
            mode === 'knowledge'
              ? 'border-primary text-foreground'
              : 'text-muted-foreground'
          )}
          onClick={function () {
            setMode('knowledge')
          }}>
          Knowledge
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            'h-8 flex-1 rounded-none border-b-2 border-transparent text-xs font-medium',
            mode === 'files' ? 'border-primary text-foreground' : 'text-muted-foreground'
          )}
          onClick={function () {
            setMode('files')
          }}>
          Files
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mode === 'knowledge' ? (
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <DocsTab />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <Overlay.Navigation onOpenPath={openEditorPath} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-full justify-between rounded-none px-2 text-[11px] text-muted-foreground"
          onClick={function () {
            setActivityOpen(!isActivityOpen)
          }}>
          <span>Activity</span>
          <span>{isActivityOpen ? '收起' : '展开'}</span>
        </Button>
        {isActivityOpen ? (
          <div className="max-h-40 min-h-0 overflow-hidden border-t border-border/60 p-2">
            <ActivityTab />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { SidebarPanel }
