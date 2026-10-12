import { toast } from 'sonner'
import { v4 as UUIDV4 } from 'uuid'

import type { FolderDraft } from './workspace-form-folders'
import {
  useAgentStore,
  type Workspace,
  type WorkspaceFolder
} from '@/stores/agent.ts'

interface SaveWorkspaceInput {
  isEdit: boolean
  workspaceID?: string | null
  title: string
  icon: string
  color: string
  draftFolders: FolderDraft[]
  onClose: () => void
}

async function archiveWorkspace(workspaceID: string, onClose: () => void) {
  try {
    await useAgentStore.getState().toUpdateWorkspace([{ id: workspaceID, archivedAt: Date.now() }])
    toast.success('已归档工作区')
    onClose()
  } catch (error) {
    console.error(error)
    toast.error('归档失败')
    throw error
  }
}

async function saveWorkspace(input: SaveWorkspaceInput) {
  const trimmed = input.title.trim()
  if (!trimmed) {
    toast.warning('请输入工作区名称')
    return false
  }
  const now = Date.now()
  try {
    const store = useAgentStore.getState()
    let workspaceID = input.workspaceID ?? UUIDV4()

    if (input.isEdit && input.workspaceID) {
      await store.toUpdateWorkspace([
        {
          id: input.workspaceID,
          title: trimmed,
          icon: input.icon,
          color: input.color
        }
      ])
      workspaceID = input.workspaceID
    } else {
      const row: Workspace = {
        id: workspaceID,
        title: trimmed,
        icon: input.icon,
        color: input.color,
        pinned: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now
      }
      await store.toWriteWorkspace([row])
      store.toActivateWorkspace(workspaceID)
    }

    const nextFolders: WorkspaceFolder[] = input.draftFolders.map(function (folder, index) {
      return {
        id: folder.id,
        workspaceID,
        path: folder.path,
        isPrimary: folder.isPrimary,
        sort: index,
        createdAt: now,
        updatedAt: now
      }
    })
    await store.toReplaceWorkspaceFolders(workspaceID, nextFolders)
    toast.success(input.isEdit ? '已保存工作区' : '已创建工作区')
    input.onClose()
    return true
  } catch (error) {
    console.error(error)
    toast.error(input.isEdit ? '保存失败' : '创建失败')
    return false
  }
}

export { archiveWorkspace, saveWorkspace }
export type { SaveWorkspaceInput }
