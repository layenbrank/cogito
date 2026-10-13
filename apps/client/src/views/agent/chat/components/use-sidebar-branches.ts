import { useAuiState } from '@assistant-ui/react'
import { useEffect, useMemo, useState } from 'react'

import type { WorkspaceBranch } from './sidebar-workspace-tree.tsx'
import { UNGROUPED_WORKSPACE } from '@/features/agent/model/workspace'
import { useAgentStore } from '@/stores/agent.ts'

/**
 * 侧栏会话条目：数据来自 assistant-ui 的线程列表（`threadItems`），
 * 只是把它摊平成树组件要的形状 —— 会话的权威状态在 runtime，store 不再另存一份。
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

function useSidebarBranches() {
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const workspaceFolders = useAgentStore(function (state) {
    return state.workspaceFolders
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
      return Object.entries(threadItems).map(function ([id, item]) {
        const custom = item.custom as { pinned?: unknown; workspaceID?: unknown } | undefined
        return {
          id,
          title: item.title ?? '新对话',
          pinned: custom?.pinned === true,
          workspaceID: typeof custom?.workspaceID === 'string' ? custom.workspaceID : null,
          updatedAt: item.lastMessageAt ? item.lastMessageAt.getTime() : 0
        }
      })
    },
    [threadItems]
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
