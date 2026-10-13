import { useMemo } from 'react'

import { useAgentStore, type Workspace, type WorkspaceFolder } from '@/stores/agent.ts'

interface ActiveWorkspace {
  workspace: Workspace | null
  workspaceID: string | null
  primaryPath: string | null
  folders: WorkspaceFolder[]
}

function findPrimaryPath(workspaceID: string | null, folders: WorkspaceFolder[]) {
  if (!workspaceID) return null
  const owned = folders.filter(function (folder) {
    return folder.workspaceID === workspaceID
  })
  const primary = owned.find(function (folder) {
    return folder.isPrimary
  })
  return primary?.path ?? owned[0]?.path ?? null
}

function useActiveWorkspace(): ActiveWorkspace {
  const workspaceID = useAgentStore(function (state) {
    return state.activeWorkspaceID
  })
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const folders = useAgentStore(function (state) {
    return state.workspaceFolders
  })

  return useMemo(
    function () {
      const workspace =
        workspaces.find(function (item) {
          return item.id === workspaceID
        }) ?? null
      const owned = folders.filter(function (folder) {
        return folder.workspaceID === workspaceID
      })
      return {
        workspace,
        workspaceID,
        primaryPath: findPrimaryPath(workspaceID, folders),
        folders: owned
      }
    },
    [workspaceID, workspaces, folders]
  )
}

export { findPrimaryPath, useActiveWorkspace }
export type { ActiveWorkspace }
