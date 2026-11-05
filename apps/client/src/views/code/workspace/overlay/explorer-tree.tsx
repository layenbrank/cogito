/**
 * Code 工作区 · Explorer 文件树（多根）
 */
import { cn } from 'cn'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu } from '@/components/contextmenu'
import { useCodeStore } from '@/stores/code'
import { CODE_MENU_CLASS_NAMES } from '@/views/code/lib/context-menu.ts'
import {
  insertCodeFile,
  insertCodeFolder,
  findParentDir,
  isPathInsideRoot,
  isSamePath,
  listWorkspaceEntries,
  removeCodePath,
  renameCodePath
} from '@/views/code/lib/fs.ts'
import { disposeModel, relocateModel } from '@/views/code/lib/monaco-models.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { relocatePath } from '@/views/code/lib/path.ts'
import {
  countDepth,
  findAbsoluteFromKey,
  makeTreeKey,
  parseTreeKey,
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
  roots: string[]
  activeKey: string | null
  /**
   * 侧栏当前是否显示文件树。
   *
   * 侧栏在「资源管理器 / 源代码管理 / 搜索」之间切换时，文件树不再卸载重挂
   * （见 workspace/sidebar.tsx），隐藏期间就不该继续读盘 —— 切走时只置脏，
   * 切回来由依赖变化触发一次刷新。
   */
  isVisible?: boolean
}

/**
 * 一次刷新最多重读多少个目录。
 *
 * 已展开目录多起来时，原来的实现是对「根 + 全部已展开目录」逐个串行 `readDir`，
 * 每个结果都触发一次整棵树 setState —— 几十个目录就是几十次 IPC + 几十次整树重渲染。
 * 上限之内按深度从浅到深铺，超出的留到下一次 treeRevision。
 */
const MAX_REFRESH_KEYS = 24

function findFolderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? '工作区'
}

/** 绝对路径落在哪个根下（找不到时回落到主根） */
function findRootForPath(roots: string[], path: string): string {
  return (
    roots.find(function (root) {
      return isPathInsideRoot(root, path)
    }) ?? roots[0]
  )
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

  const rootsKey = props.roots.join('|')

  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>(function () {
    return props.roots.map(function (root, index) {
      return {
        title: `${findFolderName(root)} (工作区)`,
        key: makeTreeKey(index, ''),
        isDirectory: true
      }
    })
  })

  const [pendingDelete, setPendingDelete] = useState<ExplorerDeleteTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<ExplorerRenameTarget | null>(null)
  const [newTarget, setNewTarget] = useState<ExplorerNewTarget | null>(null)

  /*
   * 回调必须保持引用稳定：`FileTreeItem` 的自定义 memo 会比较 onFetch / onSelect /
   * onExpandChange，只要它们每帧新建，任何一次 setTreeNodes 都会退化成整树重渲染
   * （刷新时十几个目录 = 十几次整树渲染）。可变数据走 ref 读最新值。
   */
  const rootsRef = useRef(props.roots)
  rootsRef.current = props.roots
  const treeNodesRef = useRef(treeNodes)
  treeNodesRef.current = treeNodes
  const isHiddenVisibleRef = useRef(isHiddenVisible)
  isHiddenVisibleRef.current = isHiddenVisible

  // 根集合变化：重建根节点（展开态已由 switchWorkspace 清空）
  useEffect(
    function () {
      setTreeNodes(
        rootsRef.current.map(function (root, index) {
          return {
            title: `${findFolderName(root)} (工作区)`,
            key: makeTreeKey(index, ''),
            isDirectory: true
          }
        })
      )
    },
    // roots 数组每次渲染都是新引用：用拼接值做稳定依赖
    [rootsKey]
  )

  const onSelect = useCallback(function (node: FileTreeNode) {
    void (async function () {
      const { relativePath } = parseTreeKey(node.key)
      if (!relativePath) return
      if (node.isDirectory || !node.isLeaf) return
      const absolute = findAbsoluteFromKey(rootsRef.current, node.key)
      if (!absolute) return
      await openAbsolutePath(absolute)
    })()
  }, [])

  const onFetch = useCallback(function (node: FileTreeNode): Promise<void> {
    if (node.children) return Promise.resolve()
    const { rootIndex, relativePath } = parseTreeKey(node.key)
    const root = rootsRef.current[rootIndex]
    if (!root) return Promise.resolve()
    return listWorkspaceEntries(root, relativePath, {
      isHiddenVisible: isHiddenVisibleRef.current
    })
      .then(function (entries) {
        const nextChildren: FileTreeNode[] = entries.map(function (entry) {
          return toTreeNode(entry, rootIndex)
        })
        setTreeNodes(function (origin) {
          return updateFileTreeNodes(origin, node.key, nextChildren)
        })
      })
      .catch(function (error) {
        toast.error(error instanceof Error ? error.message : '读取目录失败')
      })
  }, [])

  const onExpandChange = useCallback(
    function (key: string, open: boolean) {
      toToggleExpanded(key, open)
      if (!open) return
      const node = findFileTreeNode(treeNodesRef.current, key)
      if (node) void onFetch(node)
    },
    [toToggleExpanded, onFetch]
  )

  // 磁盘变化后重读「各根 + 已展开目录」，不再靠重挂载整棵树（否则展开状态全丢）
  useEffect(
    function () {
      // 侧栏切到「源代码管理 / 搜索」时不读盘：树保留在内存里，切回来再刷
      if (props.isVisible === false) return
      let cancelled = false
      const roots = rootsRef.current
      const currentExpanded = useCodeStore.getState().expandedKeys
      const currentExpandedSet = new Set(currentExpanded)
      const rootKeys = roots.map(function (_root, index) {
        return makeTreeKey(index, '')
      })
      // 去重 + 深度优先：先让根出来，超量部分留给下一次 treeRevision
      const keys = [...rootKeys, ...currentExpanded]
        .filter(function (key, index, list) {
          return list.indexOf(key) === index
        })
        .sort(function (a, b) {
          return countDepth(a) - countDepth(b)
        })
        .slice(0, MAX_REFRESH_KEYS)

      setTreeNodes(function (origin) {
        return pruneCollapsedNodes(origin, currentExpandedSet)
      })

      let cursor = 0
      function refreshNext() {
        if (cancelled || cursor >= keys.length) return
        const key = keys[cursor]
        cursor += 1
        const { rootIndex, relativePath } = parseTreeKey(key)
        const root = roots[rootIndex]
        if (!root) {
          refreshNext()
          return
        }
        void listWorkspaceEntries(root, relativePath, { isHiddenVisible })
          .then(function (entries) {
            if (cancelled) return
            const nextChildren = entries.map(function (entry) {
              return toTreeNode(entry, rootIndex)
            })
            setTreeNodes(function (origin) {
              return updateFileTreeNodes(origin, key, nextChildren)
            })
            refreshNext()
          })
          .catch(function (error) {
            if (cancelled) return
            console.debug('[code] refresh tree node skipped', key, error)
            refreshNext()
          })
      }

      refreshNext()
      return function () {
        cancelled = true
      }
    },
    // props.roots 每次渲染都是新数组：改成读 ref，避免「换引用就整套重读一遍」
    [treeRevision, rootsKey, isHiddenVisible, props.isVisible]
  )

  async function onConfirmCreate() {
    if (!newTarget) return
    const name = newTarget.name.trim()
    if (!name) return
    const root = props.roots[newTarget.rootIndex] ?? props.roots[0]
    if (!root) return
    try {
      if (newTarget.kind === 'folder') {
        await insertCodeFolder(root, newTarget.relativeDir, name)
        toBumpTree()
      } else {
        const absolute = await insertCodeFile(root, newTarget.relativeDir, name)
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
    const root = findRootForPath(props.roots, pendingDelete.absolute)
    if (!root) return
    try {
      await removeCodePath(pendingDelete.absolute, root, {
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
    const root = findRootForPath(props.roots, renameTarget.absolute)
    if (!root) return
    try {
      const parent = findParentDir(renameTarget.absolute)
      const next = `${parent}/${nextName}`
      if (isSamePath(renameTarget.absolute, next)) {
        setRenameTarget(null)
        return
      }
      await renameCodePath(renameTarget.absolute, next, root)

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
        roots: props.roots,
        trigger,
        setNewTarget,
        setRenameTarget,
        setPendingDelete
      })
    },
    [props.roots]
  )

  const firstRootKey = props.roots.length > 0 ? makeTreeKey(0, '') : '0::'

  return (
    <>
      <ContextMenu
        trigger="[data-tree-key]"
        classNames={CODE_MENU_CLASS_NAMES}
        findItems={findTreeMenuItems}>
        <ul
          data-tree-key={firstRootKey}
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
