/**
 * 新建 / 编辑工作区：源文件夹（多选，其一主要）+ 名称 + 图标 + 副色
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { open as dialogOpen } from '@/shared/ipc/dialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { v4 as UUIDV4 } from 'uuid'

import styles from './workspace-form.module.scss'
import { WorkspaceFormAppearance } from './workspace-form-appearance'
import { WorkspaceFormFolders, type FolderDraft } from './workspace-form-folders'
import { archiveWorkspace, saveWorkspace } from './workspace-form-save'
import { WORKSPACE_COLOR, WORKSPACE_ICON } from '@/features/agent/model/workspace'
import { useAgentStore, type WorkspaceFolder } from '@/stores/agent.ts'

interface WorkspaceFormProps {
  open: boolean
  workspaceID?: string | null
  onClose: () => void
}

const EMPTY_FOLDERS: WorkspaceFolder[] = []

function WorkspaceForm(props: WorkspaceFormProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={function (open) {
        if (!open) props.onClose()
      }}>
      <DialogContent className="sm:max-w-lg">
        {props.open ? (
          <WorkspaceFormEditor
            key={props.workspaceID ?? 'new'}
            workspaceID={props.workspaceID}
            onClose={props.onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function WorkspaceFormEditor(props: Pick<WorkspaceFormProps, 'workspaceID' | 'onClose'>) {
  const isEdit = Boolean(props.workspaceID)
  const workspace = useAgentStore(function (state) {
    if (!props.workspaceID) return null
    return (
      state.workspaces.find(function (item) {
        return item.id === props.workspaceID
      }) ?? null
    )
  })
  const workspaceFolders = useAgentStore(function (state) {
    return state.workspaceFolders
  })
  const folders = useMemo(
    function () {
      if (!props.workspaceID) return EMPTY_FOLDERS
      return workspaceFolders.filter(function (item) {
        return item.workspaceID === props.workspaceID
      })
    },
    [props.workspaceID, workspaceFolders]
  )

  const [title, updateTitle] = useState(function () {
    if (isEdit && workspace) return workspace.title
    return ''
  })
  const [icon, updateIcon] = useState(function () {
    if (isEdit && workspace) return workspace.icon || WORKSPACE_ICON
    return WORKSPACE_ICON
  })
  const [color, updateColor] = useState(function () {
    if (isEdit && workspace) return workspace.color || WORKSPACE_COLOR
    return WORKSPACE_COLOR
  })
  const [draftFolders, updateDraftFolders] = useState<FolderDraft[]>(function () {
    if (!isEdit || !workspace) return []
    return folders.map(function (folder) {
      return { id: folder.id, path: folder.path }
    })
  })
  const [saving, updateSaving] = useState(false)
  /**
   * 文件夹是异步读的（`toReadWorkspaceFolders`）。
   * 编辑态初始 draft 必然是空的 —— 数据还没回来就点保存，
   * `toReplaceWorkspaceFolders(id, [])` 会把这个工作区的文件夹绑定全删。
   * 所以：没读完不让保存；读回来且用户没动过 draft 就回填。
   */
  const [isLoadingFolders, updateLoadingFolders] = useState(isEdit)
  /** 用户是否已经手动改过 draft（改过就不再被回填覆盖） */
  const isDraftTouchedRef = useRef(false)

  useEffect(
    function () {
      const workspaceID = props.workspaceID
      if (!workspaceID) return
      let cancelled = false
      void useAgentStore
        .getState()
        .toReadWorkspaceFolders(workspaceID)
        .catch(function (error: unknown) {
          console.warn('[workspace-form] 读取工作区文件夹失败:', error)
        })
        .finally(function () {
          if (cancelled) return
          updateDraftFolders(function (prev) {
            if (isDraftTouchedRef.current) return prev
            const store = useAgentStore.getState()
            return store.workspaceFolders
              .filter(function (item) {
                return item.workspaceID === workspaceID
              })
              .map(function (folder) {
                return { id: folder.id, path: folder.path }
              })
          })
          updateLoadingFolders(false)
        })
      return function () {
        cancelled = true
      }
    },
    [props.workspaceID]
  )

  async function handleAddFolder() {
    const selected = await dialogOpen({
      directory: true,
      multiple: true,
      title: '选择可读写文件夹'
    })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    isDraftTouchedRef.current = true
    updateDraftFolders(function (prev) {
      const next = [...prev]
      for (const path of paths) {
        if (
          next.some(function (item) {
            return item.path === path
          })
        ) {
          continue
        }
        next.push({
          id: UUIDV4(),
          path
        })
      }
      return next
    })
  }

  function handleRemoveFolder(id: string) {
    isDraftTouchedRef.current = true
    updateDraftFolders(function (prev) {
      return prev.filter(function (item) {
        return item.id !== id
      })
    })
  }

  async function handleArchive() {
    if (!props.workspaceID) return
    updateSaving(true)
    try {
      await archiveWorkspace(props.workspaceID, props.onClose)
    } catch (error) {
      // toast 由 archiveWorkspace 内部弹出，这里只补一条控制台留痕
      console.warn('[workspace-form] archiveWorkspace 失败（toast 已提示）:', error)
    } finally {
      updateSaving(false)
    }
  }

  async function handleSave() {
    updateSaving(true)
    try {
      await saveWorkspace({
        isEdit,
        workspaceID: props.workspaceID,
        title,
        icon,
        color,
        draftFolders,
        onClose: props.onClose
      })
    } finally {
      updateSaving(false)
    }
  }

  // 文件夹没读完就保存 = 用空数组全量替换；宁可先禁用
  const canSubmit = title.trim().length > 0 && !isLoadingFolders

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? '编辑工作区' : '新建工作区'}</DialogTitle>
        <DialogDescription className="sr-only">配置源文件夹、名称、图标与颜色</DialogDescription>
      </DialogHeader>

      <div className={styles.body}>
        {isLoadingFolders ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Icon
              icon="lucide:loader-circle"
              aria-hidden
              className="size-3.5 animate-spin"
            />
            正在读取文件夹…
          </p>
        ) : null}
        <WorkspaceFormFolders
          folders={draftFolders}
          onAdd={function () {
            void handleAddFolder()
          }}
          onRemove={handleRemoveFolder}
        />
        <WorkspaceFormAppearance
          title={title}
          icon={icon}
          color={color}
          onTitleChange={updateTitle}
          onIconChange={updateIcon}
          onColorChange={updateColor}
        />
      </div>

      <DialogFooter className="sm:justify-between">
        {isEdit ? (
          <Button
            variant="ghost"
            className="text-destructive"
            disabled={saving}
            onClick={function () {
              void handleArchive()
            }}>
            <Icon icon="lucide:trash-2" />
            归档工作区
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={saving}
            onClick={props.onClose}>
            取消
          </Button>
          <Button
            disabled={saving || !canSubmit}
            onClick={function () {
              void handleSave()
            }}>
            {isEdit ? '保存' : '创建'}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

export { WorkspaceForm }
export type { WorkspaceFormProps }
