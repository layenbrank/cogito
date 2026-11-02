import { useMemo } from 'react'

import {
  readActiveRootPath,
  selectActiveRootPath,
  useActiveRootVersion
} from '@/features/agent/workspace/active-root'
import { useAgentStore, type Workspace, type WorkspaceFolder } from '@/stores/agent.ts'

interface ActiveWorkspace {
  workspace: Workspace | null
  workspaceID: string | null
  /** 当前文件夹：用户选中的那个，未选 / 已失效时回落列表第一个 */
  rootPath: string | null
  /** 工作区主文件夹（列表第一个），不随「当前文件夹」切换改动 */
  primaryRootPath: string | null
  /** 工作区全部文件夹（按列表顺序）；多根搜索 / 引用归属判定用 */
  folderPaths: string[]
  folders: WorkspaceFolder[]
  /** 切换当前文件夹；传 null 恢复主文件夹 */
  selectRoot: (path: string | null) => void
}

function ownedFolders(workspaceID: string | null, folders: WorkspaceFolder[]) {
  if (!workspaceID) return []
  return folders.filter(function (folder) {
    return folder.workspaceID === workspaceID
  })
}

function findRootPath(workspaceID: string | null, folders: WorkspaceFolder[]) {
  if (!workspaceID) return null
  // 不再区分主文件夹：列表顺序里的第一个就是工作区根（保存时按顺序写 sort）
  return ownedFolders(workspaceID, folders)[0]?.path ?? null
}

/** 当前文件夹：选中的优先；不在列表里就回落主文件夹 */
function resolveRootPath(workspaceID: string | null, folders: WorkspaceFolder[]) {
  const owned = ownedFolders(workspaceID, folders)
  if (owned.length === 0) return null
  const selected = readActiveRootPath(workspaceID)
  const hit = selected
    ? owned.find(function (folder) {
        return folder.path === selected
      })
    : undefined
  return hit?.path ?? owned[0]?.path ?? null
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
  const rootVersion = useActiveRootVersion()

  return useMemo(
    function () {
      const workspace =
        workspaces.find(function (item) {
          return item.id === workspaceID
        }) ?? null
      const owned = ownedFolders(workspaceID, folders)
      return {
        workspace,
        workspaceID,
        rootPath: resolveRootPath(workspaceID, folders),
        primaryRootPath: owned[0]?.path ?? null,
        folderPaths: owned.map(function (folder) {
          return folder.path
        }),
        folders: owned,
        selectRoot: function (path: string | null) {
          if (workspaceID) selectActiveRootPath(workspaceID, path)
        }
      }
      // readActiveRootPath 不是响应式的：靠 rootVersion 作依赖，切换文件夹时重算
      void rootVersion
    },
    [workspaceID, workspaces, folders, rootVersion]
  )
}

export { findRootPath, resolveRootPath, useActiveWorkspace }
export type { ActiveWorkspace }
