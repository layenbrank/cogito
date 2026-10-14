import { useAuiState } from '@assistant-ui/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { WorkspaceBranch } from './sidebar-workspace-tree.tsx'
import { UNGROUPED_WORKSPACE } from '@/features/agent/model/workspace'
import { useAgentStore } from '@/stores/agent.ts'

/**
 * 侧栏会话条目：数据来自 assistant-ui 的线程列表（`threadIds` + `threadItems`）。
 *
 * 自动展开只在「出现新工作区 id」时写一次 state；依赖稳定的 id 串，
 * 避免流式时 `threadItems` 每帧换引用 → effect 与 Collapsible `onOpenChange` 互殴
 * （Maximum update depth / 页面崩溃、会话流被中断）。
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

  /** 仅 id 列表；流式更新 title/updatedAt 不会触发自动展开 effect */
  const branchIdsKey = useMemo(
    function () {
      return branches
        .map(function (branch) {
          return branch.id
        })
        .join('\0')
    },
    [branches]
  )

  const seededIdsRef = useRef<Set<string>>(new Set())

  useEffect(
    function () {
      if (!branchIdsKey) return
      const ids = branchIdsKey.split('\0').filter(Boolean)
      const missing = ids.filter(function (id) {
        return !seededIdsRef.current.has(id)
      })
      if (missing.length === 0) return

      for (const id of missing) seededIdsRef.current.add(id)

      updateExpandedKeys(function (prev) {
        const next = new Set(prev)
        let changed = false
        for (const id of missing) {
          if (!next.has(id)) {
            next.add(id)
            changed = true
          }
        }
        return changed ? Array.from(next) : prev
      })
    },
    [branchIdsKey]
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
