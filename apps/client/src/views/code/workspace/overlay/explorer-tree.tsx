/**
 * Code 工作区 · Explorer 文件树
 */
import { cn } from 'cn'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu } from '@/components/contextmenu'
import { useCodeStore } from '@/stores/code'
import { CODE_MENU_CLASS_NAMES } from '@/views/code/lib/context-menu.ts'
import {
  insertCodeFile,
  insertCodeFolder,
  findParentDir,
  isSamePath,
  joinPath,
  listWorkspaceEntries,
  removeCodePath,
  renameCodePath
} from '@/views/code/lib/fs.ts'
import { disposeModel, relocateModel } from '@/views/code/lib/monaco-models.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { relocatePath } from '@/views/code/lib/path.ts'
import {
  EXPLORER_ROOT_KEY,
  countDepth,
  pruneCollapsedNodes,
  toTreeNode,
  type ExplorerDeleteTarget,
  type ExplorerNewTarget,
  type ExplorerRenameTarget
} from '@/views/code/workspace/overlay/explorer-tree-lib.ts'
import { DeleteConfirmDialog, NameDialog } from '@/views/code/workspace/overlay/explorer-tree-dialogs.tsx'
import { buildExplorerTreeMenuItems } from '@/views/code/workspace/overlay/explorer-tree-menu.tsx'
import {
  FileTreeItem,
  type FileTreeNode
} from '@/views/workspace/overlay/file-tree-item.tsx'
import { findFileTreeNode, updateFileTreeNodes } from '@/views/workspace/overlay/file-tree.ts'

interface ExplorerTreeProps {
  workspaceRoot: string
  activeKey: string | null
}

function ExplorerTree(props: ExplorerTreeProps) {
  const toBumpTree = useCodeStore(function (state) {
    return state.toBumpTree
  })
  const treeRevision = useCodeStore(function (state) {
    return state.treeRevision
  })
  const expandedKeys = useCodeStore(function (state) {
    return state.expandedKeys
  })
  const isHiddenVisible = useCodeStore(function (state) {
    return state.isHiddenVisible
  })
  const toToggleExpanded = useCodeStore(function (state) {
    return state.toToggleExpanded
  })

  const expandedSet = useMemo(
    function () {
      return new Set(expandedKeys)
    },
    [expandedKeys]
  )

  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>(function () {
    const folder = props.workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? '工作区'
    return [
      {
        title: `${folder} (工作区)`,
        key: EXPLORER_ROOT_KEY,
        isDirectory: true
      }
    ]
  })

  const [pendingDelete, setPendingDelete] = useState<ExplorerDeleteTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<ExplorerRenameTarget | null>(null)
  const [newTarget, setNewTarget] = useState<ExplorerNewTarget | null>(null)

  function onSelect(node: FileTreeNode) {
    void (async function () {
      if (node.key === EXPLORER_ROOT_KEY) return
      if (node.isDirectory || !node.isLeaf) return
      const absolute = joinPath(props.workspaceRoot, node.key)
      await openAbsolutePath(absolute)
    })()
  }

  function onExpandChange(key: string, open: boolean) {
    toToggleExpanded(key, open)
    if (!open) return
    const node = findFileTreeNode(treeNodes, key)
    if (node) void onFetch(node)
  }

  async function onFetch(node: FileTreeNode) {
    if (node.children) return
    const relativePath = node.key === EXPLORER_ROOT_KEY ? '' : node.key
    try {
      const entries = await listWorkspaceEntries(props.workspaceRoot, relativePath, {
        isHiddenVisible
      })
      const nextChildren: FileTreeNode[] = entries.map(toTreeNode)
      setTreeNodes(function (origin) {
        return updateFileTreeNodes(origin, node.key, nextChildren)
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取目录失败')
    }
  }

  // 磁盘变化后重读「根 + 已展开目录」，不再靠重挂载整棵树（否则展开状态全丢）
  useEffect(
    function () {
      let cancelled = false
      // 展开状态从 store 现取：把它放进依赖会让每次展开/折叠都触发整棵树重读
      const currentExpanded = useCodeStore.getState().expandedKeys
      const currentExpandedSet = new Set(currentExpanded)
      const keys = [EXPLORER_ROOT_KEY, ...currentExpanded].sort(function (a, b) {
        return countDepth(a) - countDepth(b)
      })

      // 先丢弃未展开目录的缓存，下次展开时按需重读，避免看到旧内容
      setTreeNodes(function (origin) {
        return pruneCollapsedNodes(origin, currentExpandedSet)
      })

      // 按深度顺序逐键刷新，避免并行 setTreeNodes 互相覆盖
      function refreshKey(index: number) {
        if (cancelled || index >= keys.length) return
        const key = keys[index]
        const relativePath = key === EXPLORER_ROOT_KEY ? '' : key
        void listWorkspaceEntries(props.workspaceRoot, relativePath, {
          isHiddenVisible
        })
          .then(function (entries) {
            if (cancelled) return
            const nextChildren = entries.map(toTreeNode)
            setTreeNodes(function (origin) {
              return updateFileTreeNodes(origin, key, nextChildren)
            })
            refreshKey(index + 1)
          })
          .catch(function (error) {
            if (cancelled) return
            console.debug('[code] refresh tree node skipped', key, error)
            refreshKey(index + 1)
          })
      }

      refreshKey(0)
      return function () {
        cancelled = true
      }
    },
    [treeRevision, props.workspaceRoot, isHiddenVisible]
  )

  async function onConfirmCreate() {
    if (!newTarget) return
    const name = newTarget.name.trim()
    if (!name) return
    try {
      if (newTarget.kind === 'folder') {
        await insertCodeFolder(props.workspaceRoot, newTarget.relativeDir, name)
        toBumpTree()
      } else {
        const absolute = await insertCodeFile(
          props.workspaceRoot,
          newTarget.relativeDir,
          name
        )
        toBumpTree()
        await openAbsolutePath(absolute)
      }
      setNewTarget(null)
    } catch (error) {
      console.error(error)
      toast.error(
        newTarget.kind === 'folder'
          ? error instanceof Error
            ? error.message
            : '创建文件夹失败'
          : error instanceof Error
            ? error.message
            : '创建文件失败'
      )
    }
  }

  async function onConfirmDelete() {
    if (!pendingDelete) return
    try {
      await removeCodePath(pendingDelete.absolute, props.workspaceRoot, {
        recursive: pendingDelete.isDirectory
      })
      const closed = useCodeStore.getState().toCloseByPath(pendingDelete.absolute)
      for (const path of closed) {
        disposeModel(path)
      }
      setPendingDelete(null)
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function onConfirmRename() {
    if (!renameTarget) return
    const nextName = renameTarget.name.trim()
    if (!nextName) return
    try {
      const parent = findParentDir(renameTarget.absolute)
      const next = `${parent}/${nextName}`
      if (isSamePath(renameTarget.absolute, next)) {
        setRenameTarget(null)
        return
      }
      await renameCodePath(renameTarget.absolute, next, props.workspaceRoot)

      const store = useCodeStore.getState()
      const snapshot = store.tabs.slice()
      for (const tab of snapshot) {
        const relocated = relocatePath(tab.path, renameTarget.absolute, next)
        if (!relocated) continue
        relocateModel(tab.path, relocated)
      }
      store.toRelocatePath(renameTarget.absolute, next)
      setRenameTarget(null)
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : '重命名失败')
    }
  }
  const findTreeMenuItems = useCallback(
    function (trigger: Element) {
      return buildExplorerTreeMenuItems({
        workspaceRoot: props.workspaceRoot,
        trigger,
        setNewTarget,
        setRenameTarget,
        setPendingDelete
      })
    },
    [props.workspaceRoot]
  )

  return (
    <>
      <ContextMenu
        trigger="[data-tree-key]"
        classNames={CODE_MENU_CLASS_NAMES}
        findItems={findTreeMenuItems}>
        <ul
          data-tree-key={EXPLORER_ROOT_KEY}
          data-tree-kind="directory"
          className={cn('h-full w-full list-none overflow-x-hidden overflow-y-auto py-0.5 text-sm')}>
          {treeNodes.map(function (node) {
            return (
              <FileTreeItem
                key={node.key}
                node={node}
                activeKey={props.activeKey}
                expandedKeys={expandedSet}
                onFetch={onFetch}
                onSelect={onSelect}
                onExpandChange={onExpandChange}
              />
            )
          })}
        </ul>
      </ContextMenu>

      <DeleteConfirmDialog
        target={pendingDelete}
        onCancel={function () {
          setPendingDelete(null)
        }}
        onConfirm={function () {
          void onConfirmDelete()
        }}
      />

      <NameDialog
        title="重命名"
        name={renameTarget?.name ?? null}
        onChange={function (name) {
          setRenameTarget(function (prev) {
            if (!prev) return prev
            return { ...prev, name }
          })
        }}
        onCancel={function () {
          setRenameTarget(null)
        }}
        onConfirm={function () {
          void onConfirmRename()
        }}
      />

      <NameDialog
        title={newTarget?.kind === 'folder' ? '新建文件夹' : '新建文件'}
        name={newTarget?.name ?? null}
        onChange={function (name) {
          setNewTarget(function (prev) {
            if (!prev) return prev
            return { ...prev, name }
          })
        }}
        onCancel={function () {
          setNewTarget(null)
        }}
        onConfirm={function () {
          void onConfirmCreate()
        }}
      />
    </>
  )
}

export { ExplorerTree }
