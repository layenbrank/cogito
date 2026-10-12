import { useEffect, useMemo, useState } from 'react'

import type { WorkspaceBranch } from './sidebar-workspace-tree.tsx'
import { UNGROUPED_WORKSPACE } from '@/features/agent/model/workspace'
import { useAgentStore, type Session } from '@/stores/agent.ts'

function sortSessions(a: Session, b: Session) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.updatedAt - a.updatedAt
}

function useSidebarBranches() {
  const sessions = useAgentStore(function (state) {
    return state.sessions
  })
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const workspaceFolders = useAgentStore(function (state) {
    return state.workspaceFolders
  })

  const [expandedKeys, updateExpandedKeys] = useState<string[]>([])
  const expandedKeySet = useMemo(function () {
    return new Set(expandedKeys)
  }, [expandedKeys])

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
