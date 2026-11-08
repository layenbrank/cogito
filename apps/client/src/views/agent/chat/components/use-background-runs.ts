import { useAuiState } from '@assistant-ui/react'
import type { BackgroundRun } from '@cogito/design/assistant/background-inbox.aui'
import { useMemo } from 'react'

import { useFinishedThreads, useRunningThreads } from '@/features/agent/acp/run-state'
import {
  buildThreadItemIndex,
  findIndexedThreadItem
} from '@/views/agent/chat/components/thread-items.ts'

function formatElapsed(at: Date | undefined): string {
  if (!at) return ''
  const minutes = Math.round((Date.now() - at.getTime()) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.round(minutes / 60)} 小时`
}

/**
 * 后台收件箱的数据：运行中的 + 已跑完待领取的（都不含当前会话）。
 * 运行态来自 `run-state`（ACP 控制器层），标题/时间来自 assistant-ui 线程列表。
 */
function useBackgroundRuns(): BackgroundRun[] {
  const runningIDs = useRunningThreads()
  const finishedIDs = useFinishedThreads()
  const threadItems = useAuiState(function (state) {
    return state.threads.threadItems
  })
  const activeID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })

  // 一次建索引：数组形态下逐条 `.find()` 是 O(后台会话 × 列表长度)，记录形态还会直接抛
  const itemIndex = useMemo(function () {
    return buildThreadItemIndex(threadItems)
  }, [threadItems])

  function findItem(id: string) {
    return findIndexedThreadItem(itemIndex, id)
  }

  const runs: BackgroundRun[] = []
  for (const id of runningIDs) {
    if (id === activeID) continue
    const item = findItem(id)
    runs.push({
      id,
      title: item?.title ?? '新任务',
      state: 'running',
      elapsed: formatElapsed(item?.lastMessageAt)
    })
  }
  for (const id of finishedIDs) {
    if (id === activeID) continue
    const item = findItem(id)
    runs.push({
      id,
      title: item?.title ?? '新任务',
      state: 'ready',
      elapsed: formatElapsed(item?.lastMessageAt)
    })
  }
  return runs
}

export { useBackgroundRuns }
