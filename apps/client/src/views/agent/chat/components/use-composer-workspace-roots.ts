import { useMemo } from 'react'

import { rootLabel } from './attach-menu-path'
import type { WorkspaceRoot } from './attach-menu'
import { useAgentStore, type WorkspaceFolder } from '@/stores/agent'

const EMPTY_FOLDERS: WorkspaceFolder[] = []

function useComposerWorkspaceRoots() {
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const workspaceFolders = useAgentStore(function (state) {
    return state.workspaceFolders
  })
  const activeWorkspaceID = useAgentStore(function (state) {
    return state.activeWorkspaceID
  })

  const activeWorkspace = workspaces.find(function (item) {
    return item.id === activeWorkspaceID
  })

  const activeFolders = useMemo(
    function () {
      if (!activeWorkspaceID) return EMPTY_FOLDERS
      return workspaceFolders
        .filter(function (folder) {
          return folder.workspaceID === activeWorkspaceID
        })
        .slice()
        .sort(function (a, b) {
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
          return a.sort - b.sort
        })
    },
    [activeWorkspaceID, workspaceFolders]
  )

  const roots: WorkspaceRoot[] = useMemo(
    function () {
      return activeFolders.map(function (folder) {
        return {
          id: folder.id,
          path: folder.path,
          label: rootLabel(folder.path)
        }
      })
    },
    [activeFolders]
  )

  const rootPaths = useMemo(
    function () {
      return roots.map(function (item) {
        return item.path
      })
    },
    [roots]
  )

  const primaryPath = activeFolders[0]?.path ?? null

  return {
    activeWorkspace,
    roots,
    rootPaths,
    primaryPath
  }
}

export { useComposerWorkspaceRoots }
