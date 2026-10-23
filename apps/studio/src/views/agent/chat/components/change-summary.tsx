import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { useSessionChanges, useUndoChanges } from '@/features/agent/changes.ts'
import { useSessionID } from '@/features/chat/session.ts'
import { useAsidePanel } from './use-aside-panel.ts'

/**
 * 本会话文件变更汇总条（对齐 Qoder「已编辑 N 个文件」卡）。
 *
 * 数据来自主进程 change journal，不靠 git status；这里只给「有几个文件、加减多少行」和
 * 两个动作，完整清单与逐文件撤销在右栏「变更」段 —— 同一份数据两处都渲染列表，
 * 迟早出现「这里撤销了、那里还显示」的错觉。
 */
export function ChangeSummary() {
  const sessionID = useSessionID()
  if (sessionID === null) return null

  return <ChangeSummaryBar sessionID={sessionID} />
}

function ChangeSummaryBar(props: { sessionID: string }) {
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const changes = useSessionChanges(props.sessionID, isRunning)
  const undo = useUndoChanges(props.sessionID)
  const { open } = useAsidePanel()

  const entries = changes.data?.entries ?? []
  if (entries.length === 0) return null

  const added = changes.data?.added ?? 0
  const removed = changes.data?.removed ?? 0

  return (
    <div className="border-border bg-card mb-2 overflow-hidden rounded-lg border shadow-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon icon="lucide:file-pen-line" className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">已编辑 {entries.length} 个文件</p>
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Badge
              variant="outline"
              className="border-success/40 text-success">
              +{added}
            </Badge>
            <Badge
              variant="outline"
              className="border-destructive/40 text-destructive">
              −{removed}
            </Badge>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={undo.isPending}
          onClick={function () {
            undo.mutate(undefined)
          }}>
          <Icon icon="lucide:rotate-ccw" />
          撤销
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={function () {
            open('changes')
          }}>
          <Icon icon="lucide:scan-search" />
          审阅
        </Button>
      </div>
    </div>
  )
}
