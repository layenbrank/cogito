import { useAuiState } from '@assistant-ui/react'
import { useEffect, useMemo, useState } from 'react'

import type { WorkspaceBranch } from './sidebar-workspace-tree.tsx'
import { UNGROUPED_WORKSPACE } from '@/features/agent/model/workspace'
import { useAgentStore } from '@/stores/agent.ts'

/**
 * 侧栏会话条目：数据来自 assistant-ui 的线程列表（`threadIds` + `threadItems`），
 * 只是把它摊平成树组件要的形状 —— 会话的权威状态在 runtime，store 不再另存一份。
 *
 * `threadItems` 是 Record（键为 slot id），**不是**数组。用 `Object.entries` 当数组会
 * 把下标 `"0"`/`"1"` 当成 id → `switchToThread` 找不到线程 → 点开会话空白。
 * 正确做法对齐 studio：遍历 `threadIds`，再按 id 查 `threadItems`。
 */
interface SidebarSession {
  id: string
  title: string
  pinned: boolean
  workspaceID: string | null
  updatedAt: number
}

function sortSessions(a: SidebarSession, b: SidebarSession) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.updatedAt - a.updatedAt
}

interface ThreadItemSnapshot {
  id?: string
  title?: string
  lastMessageAt?: Date
  custom?: { pinned?: unknown; workspaceID?: unknown }
  remoteId?: string
}

function findThreadItem(threadItems: unknown, id: string): ThreadItemSnapshot | null {
  if (!threadItems || typeof threadItems !== 'object') return null
  if (Array.isArray(threadItems)) {
    return (
      threadItems.find(function (item: ThreadItemSnapshot) {
        return item?.id === id || item?.remoteId === id
      }) ?? null
    )
  }
  const record = threadItems as Record<string, ThreadItemSnapshot>
  return record[id] ?? null
}

function useSidebarBranches() {
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const workspaceFolders = useAgentStore(function (state) {
    return state.workspaceFolders
  })
  const threadIds = useAuiState(function (state) {
    return state.threads.threadIds
  })
  const threadItems = useAuiState(function (state) {
    return state.threads.threadItems
  })

  const [expandedKeys, updateExpandedKeys] = useState<string[]>([])
  const expandedKeySet = useMemo(function () {
    return new Set(expandedKeys)
  }, [expandedKeys])

  const sessions: SidebarSession[] = useMemo(
    function () {
      return threadIds.map(function (id) {
        const item = findThreadItem(threadItems, id)
        const custom = item?.custom
        return {
          id,
          title: item?.title ?? '新对话',
          pinned: custom?.pinned === true,
          workspaceID: typeof custom?.workspaceID === 'string' ? custom.workspaceID : null,
          updatedAt: item?.lastMessageAt ? item.lastMessageAt.getTime() : 0
        }
      })
    },
    [threadIds, threadItems]
  )

  const branches: WorkspaceBranch[] = useMemo(
    function () {
      const sortedWorkspaces = workspaces.toSorted(function (a, b) {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.updatedAt - a.updatedAt
      })

      const result: WorkspaceBranch[] = []

      for (const workspace of sortedWorkspaces) {
        const matched = sessions.filter(function (session) {
          return session.workspaceID === workspace.id
        })

        const paths = workspaceFolders
          .filter(function (folder) {
            return folder.workspaceID === workspace.id
          })
          .toSorted(function (a, b) {
            if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
            return a.sort - b.sort
          })
          .map(function (folder) {
            return folder.path
          })

        result.push({
          id: workspace.id,
          title: workspace.title,
          icon: workspace.icon,
          color: workspace.color,
          pinned: workspace.pinned,
          paths,
          sessions: matched.toSorted(sortSessions)
        })
      }

      const ungrouped = sessions.filter(function (session) {
        return !session.workspaceID
      })
      if (ungrouped.length > 0) {
        result.push({
          id: UNGROUPED_WORKSPACE,
          title: '未分组',
          icon: 'folder',
          color: '',
          pinned: false,
          paths: [],
          sessions: ungrouped.toSorted(sortSessions)
        })
      }

      return result
    },
    [workspaces, sessions, workspaceFolders]
  )

  useEffect(
    function () {
      updateExpandedKeys(function (prev) {
        const next = new Set(prev)
        let changed = false
        for (const branch of branches) {
          if (!next.has(branch.id)) {
            next.add(branch.id)
            changed = true
          }
        }
        return changed ? Array.from(next) : prev
      })
    },
    [branches]
  )

  return {
    branches,
    expandedKeys,
    expandedKeySet,
    updateExpandedKeys
  }
}

export { useSidebarBranches }
export type { SidebarSession }
