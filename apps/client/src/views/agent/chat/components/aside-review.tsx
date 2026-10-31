/**
 * 右栏审阅：工作区未提交变更列表 + 点选对比。
 *
 * 清单以 `git status` 为准，并合并本会话写文件工具触及的路径
 * （尚未落盘到 git 感知范围时也能点进去看）。
 */
import { useAuiState } from '@assistant-ui/react'
import { useEffect, useRef, useState } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import { AsideDiff } from '@/views/agent/chat/components/aside-diff'
import { AsideReviewList } from '@/views/agent/chat/components/aside-review-list'
import { useAsideReviewRows } from '@/views/agent/chat/components/aside-review-rows'
import { useAsideReviewStatus } from '@/views/agent/chat/components/use-aside-review-status'

interface AsideReviewProps {
  initialRelative?: string | null
}

function AsideReview(props: AsideReviewProps) {
  const { rootPath } = useActiveWorkspace()
  const revision = useWorkspaceRevision()
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const wasRunning = useRef(isRunning)

  const [selected, updateSelected] = useState<string | null>(props.initialRelative ?? null)
  const [seenInitial, updateSeenInitial] = useState(props.initialRelative ?? null)
  const [refreshKey, updateRefreshKey] = useState(0)

  if (props.initialRelative !== seenInitial) {
    updateSeenInitial(props.initialRelative ?? null)
    updateSelected(props.initialRelative ?? null)
  }

  const status = useAsideReviewStatus(rootPath, refreshKey, revision)
  const rows = useAsideReviewRows(rootPath, status.entries, messages)

  useEffect(
    function () {
      if (wasRunning.current && !isRunning) {
        updateRefreshKey(function (value) {
          return value + 1
        })
      }
      wasRunning.current = isRunning
    },
    [isRunning]
  )

  if (!rootPath) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs">
        先在左栏添加一个工作区
      </div>
    )
  }

  if (selected) {
    return (
      <AsideDiff
        rootPath={rootPath}
        relative={selected}
        onBack={function () {
          updateSelected(null)
        }}
      />
    )
  }

  return (
    <AsideReviewList
      rows={rows}
      isPending={status.isPending}
      error={status.error}
      isRepo={status.isRepo}
      onRefresh={function () {
        updateRefreshKey(function (value) {
          return value + 1
        })
      }}
      onSelect={function (path) {
        updateSelected(path)
      }}
    />
  )
}

export { AsideReview }
