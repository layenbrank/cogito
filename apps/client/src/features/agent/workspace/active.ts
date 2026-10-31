import { useMemo } from 'react'

import { useAgentStore, type Workspace, type WorkspaceFolder } from '@/stores/agent.ts'

interface ActiveWorkspace {
  workspace: Workspace | null
  workspaceID: string | null
  rootPath: string | null
  folders: WorkspaceFolder[]
}

function findRootPath(workspaceID: string | null, folders: WorkspaceFolder[]) {
  if (!workspaceID) return null
  const owned = folders.filter(function (folder) {
    return folder.workspaceID === workspaceID
  })
  // 不再区分主文件夹：列表顺序里的第一个就是工作区根（保存时按顺序写 sort）
  return owned[0]?.path ?? null
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
        rootPath: findRootPath(workspaceID, folders),
        folders: owned
      }
    },
    [workspaceID, workspaces, folders]
  )
}

export { findRootPath, useActiveWorkspace }
export type { ActiveWorkspace }
