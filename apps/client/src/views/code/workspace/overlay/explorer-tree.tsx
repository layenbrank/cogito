/**
 * Code 工作区 · Explorer 文件树（多根）
 */
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
import {
  EXPLORER_CHUNK_SIZE,
  EXPLORER_PAGE_SIZE,
  appendUniqueEntries,
  findLoadMoreTitle,
  makeLoadMoreKey,
  toLoadMoreParentKey
} from '@/views/code/lib/paging.ts'
import { disposeModel, relocateModel } from '@/views/code/lib/monaco-models.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { relocatePath } from '@/views/code/lib/path.ts'
import {
  countDepth,
  dropExpandedSubtree,
  findAbsoluteFromKey,
  makeTreeKey,
  parseTreeKey,
  toTreeNode,
  type ExplorerDeleteTarget,
  type ExplorerNewTarget,
  type ExplorerRenameTarget
} from '@/views/code/workspace/overlay/explorer-tree-lib.ts'
import { DeleteConfirmDialog, NameDialog } from '@/views/code/workspace/overlay/explorer-tree-dialogs.tsx'
import { startExplorerOp, perfNow } from '@/views/code/workspace/overlay/explorer-perf.ts'
import { buildExplorerTreeMenuItems } from '@/views/code/workspace/overlay/explorer-tree-menu.tsx'
import { ExplorerFlatList } from '@/views/code/workspace/overlay/explorer-flat-list.tsx'
import { flattenExplorerRows } from '@/views/code/workspace/overlay/explorer-rows.ts'
import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-node.ts'
import {
  appendFileTreeChildren,
  dropFileTreeChildren,
  findFileTreeNode,
  patchFileTreeNode,
  scheduleChunkedChildren,
  updateFileTreeNodes
} from '@/views/workspace/overlay/file-tree.ts'

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

/** 给某层目录造「显示更多」哨兵节点 */
function toLoadMoreNode(parentKey: string, remaining: number): FileTreeNode {
  return {
    title: findLoadMoreTitle(remaining),
    key: makeLoadMoreKey(parentKey),
    isLoadMore: true
  }
}

interface CommitChildrenParams {
  key: string
  nodes: FileTreeNode[]
  mode: 'replace' | 'append'
  isTruncated: boolean
  nextOffset: number
  total: number
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

  const isExpanded = useCallback(function (key: string) {
    return expandedSet.has(key)
  }, [expandedSet])

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

  /** 可见行：树按展开态压平，虚拟列表只渲染窗口内的几十行 */
  const rows = useMemo(
    function () {
      return flattenExplorerRows(treeNodes, expandedSet)
    },
    [treeNodes, expandedSet]
  )

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

  /** 每层目录的分帧写入取消器：折叠 / 重取 / 卸载都要停 */
  const chunkCancelsRef = useRef(new Map<string, () => void>())

  /** 正在读盘的目录 key：兜底拉取与用户点击可能同时触发，避免重复 IPC */
  const pendingFetchesRef = useRef<Set<string>>(new Set())

  useEffect(function () {
    const cancels = chunkCancelsRef.current
    return function () {
      for (const cancel of cancels.values()) cancel()
      cancels.clear()
    }
  }, [])

  /** 取消某层目录尚未灌完的行；返回是否真的有在跑的任务 */
  const cancelChunks = useCallback(function (key: string): boolean {
    const cancel = chunkCancelsRef.current.get(key)
    if (!cancel) return false
    cancel()
    chunkCancelsRef.current.delete(key)
    return true
  }, [])

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

  /**
   * 把一页子项写进树：首批同步挂上，其余每帧 50 行。
   *
   * 「显示更多」哨兵只在最后一帧补上（否则它会先出现在列表中间）。
   * append 模式按 key 去重：watch 刷新与「显示更多」可能同时往同一层塞子项。
   */
  const commitChildren = useCallback(
    function (params: CommitChildrenParams) {
      const { key, nodes, mode, isTruncated, nextOffset, total } = params
      cancelChunks(key)
      const meta = { hasMore: isTruncated, nextOffset }
      const sentinel = isTruncated ? toLoadMoreNode(key, Math.max(total - nextOffset, 0)) : null
      let isFinished = false
      const cancel = scheduleChunkedChildren(
        function (chunk, isFirst, isDone) {
          const payload = isDone && sentinel ? [...chunk, sentinel] : chunk
          setTreeNodes(function (origin) {
            if (mode === 'replace' && isFirst) {
              return updateFileTreeNodes(origin, key, payload, meta)
            }
            const target = findFileTreeNode(origin, key)
            const current = (target?.children ?? []).filter(function (child) {
              return !child.isLoadMore
            })
            const merged = appendUniqueEntries(current, payload, function (node) {
              return node.key
            })
            return appendFileTreeChildren(origin, key, merged.slice(current.length), meta)
          })
          if (isDone) {
            isFinished = true
            chunkCancelsRef.current.delete(key)
          }
        },
        nodes,
        EXPLORER_CHUNK_SIZE
      )
      // 首批是同步写的：节点很少时 pump 已经在返回前写完，别把死取消器留在表里
      if (!isFinished) chunkCancelsRef.current.set(key, cancel)
    },
    [cancelChunks]
  )

  const onFetch = useCallback(
    function (node: FileTreeNode): Promise<void> {
      // 已加载完（分帧未写完时 isLoaded 仍是 false）才短路，允许取消后重取
      if (node.children && node.isLoaded) return Promise.resolve()
      if (pendingFetchesRef.current.has(node.key)) return Promise.resolve()
      pendingFetchesRef.current.add(node.key)
      const { rootIndex, relativePath } = parseTreeKey(node.key)
      const root = rootsRef.current[rootIndex]
      if (!root) {
        pendingFetchesRef.current.delete(node.key)
        return Promise.resolve()
      }
      // 目录行上的转圈：读盘期间别让用户以为点了没反应
      setTreeNodes(function (origin) {
        return patchFileTreeNode(origin, node.key, { isLoading: true })
      })
      const trace = startExplorerOp('fetch', relativePath)
      const startedAt = perfNow()
      return listWorkspaceEntries(root, relativePath, {
        isHiddenVisible: isHiddenVisibleRef.current,
        offset: 0
      })
        .then(function (page) {
          trace.read(perfNow() - startedAt).count(page.entries.length)
          const nextChildren: FileTreeNode[] = page.entries.map(function (entry) {
            return toTreeNode(entry, rootIndex)
          })
          commitChildren({
            key: node.key,
            nodes: nextChildren,
            mode: 'replace',
            isTruncated: page.isTruncated,
            nextOffset: page.nextOffset,
            total: page.total
          })
          trace.settle()
        })
        .catch(function (error) {
          trace.count(0).settle()
          toast.error(error instanceof Error ? error.message : '读取目录失败')
        })
        .finally(function () {
          pendingFetchesRef.current.delete(node.key)
        })
    },
    [commitChildren]
  )

  const loadMore = useCallback(
    function (parentKey: string): Promise<void> {
      const node = findFileTreeNode(treeNodesRef.current, parentKey)
      if (!node) return Promise.resolve()
      const { rootIndex, relativePath } = parseTreeKey(parentKey)
      const root = rootsRef.current[rootIndex]
      if (!root) return Promise.resolve()
      const rendered = (node.children ?? []).filter(function (child) {
        return !child.isLoadMore
      }).length
      const offset = node.nextOffset ?? rendered
      const trace = startExplorerOp('fetch', relativePath)
      const startedAt = perfNow()
      return listWorkspaceEntries(root, relativePath, {
        isHiddenVisible: isHiddenVisibleRef.current,
        offset
      })
        .then(function (page) {
          trace.read(perfNow() - startedAt).count(page.entries.length)
          const extra: FileTreeNode[] = page.entries.map(function (entry) {
            return toTreeNode(entry, rootIndex)
          })
          commitChildren({
            key: parentKey,
            nodes: extra,
            mode: 'append',
            isTruncated: page.isTruncated,
            nextOffset: page.nextOffset,
            total: page.total
          })
          trace.settle()
        })
        .catch(function (error) {
          trace.count(0).settle()
          toast.error(error instanceof Error ? error.message : '读取目录失败')
        })
    },
    [commitChildren]
  )

  const onSelect = useCallback(
    function (node: FileTreeNode) {
      if (node.isLoadMore) {
        const parentKey = toLoadMoreParentKey(node.key)
        if (parentKey) void loadMore(parentKey)
        return
      }
      void (async function () {
        const { relativePath } = parseTreeKey(node.key)
        if (!relativePath) return
        if (node.isDirectory || !node.isLeaf) return
        const absolute = findAbsoluteFromKey(rootsRef.current, node.key)
        if (!absolute) return
        await openAbsolutePath(absolute)
      })()
    },
    [loadMore]
  )

  const onExpandChange = useCallback(
    function (key: string, open: boolean) {
      toToggleExpanded(key, open)
      if (!open) {
        // 折叠即失效：停掉还没灌完的帧，丢掉这层的子节点缓存，并连带丢弃子孙的展开态。
        // 只动这一条路径（结构共享），未受影响的子树引用不变，不触发重渲染。
        cancelChunks(key)
        const store = useCodeStore.getState()
        const nextExpanded = dropExpandedSubtree(store.expandedKeys, key)
        if (nextExpanded.length !== store.expandedKeys.length) {
          store.toDropExpandedKeys(nextExpanded)
        }
        setTreeNodes(function (origin) {
          return dropFileTreeChildren(origin, key)
        })
        return
      }
      const node = findFileTreeNode(treeNodesRef.current, key)
      if (node) void onFetch(node)
    },
    [toToggleExpanded, onFetch, cancelChunks]
  )

  /**
   * 展开态兜底拉取。
   *
   * 虚拟列表下目录行不再「挂载即取数」，而面包屑定位（toRevealPath）只改 store 里的
   * 展开集合 —— 这里统一补：某层被展开但还没有数据，就拉一次。
   * 父目录按插入顺序排在前面，一轮 effect 后子层节点才存在，下一轮自然接上。
   */
  useEffect(
    function () {
      for (const key of expandedKeys) {
        const node = findFileTreeNode(treeNodesRef.current, key)
        if (!node || node.isLoadMore || node.isLeaf) continue
        if (node.isLoaded || node.isLoading) continue
        if (pendingFetchesRef.current.has(key)) continue
        void onFetch(node)
      }
    },
    [expandedKeys, treeNodes, onFetch]
  )

  // 磁盘变化后重读「各根 + 已展开目录」，不再靠重挂载整棵树（否则展开状态全丢）
  useEffect(
    function () {
      // 侧栏切到「源代码管理 / 搜索」时不读盘：树保留在内存里，切回来再刷
      if (props.isVisible === false) return
      let cancelled = false
      const roots = rootsRef.current
      const store = useCodeStore.getState()
      const currentExpanded = store.expandedKeys
      const rootKeys = roots.map(function (_root, index) {
        return makeTreeKey(index, '')
      })
      /*
       * watch 推来的脏目录优先：只重读这几层。
       * 折叠的分支 / 不在根里的 key 直接丢掉 —— 它们没显示，重读一遍纯属白跑。
       * 没有脏目录（用户新建 / 重命名 / 删除后 toBumpTree）时才退回「根 + 全部已展开」。
       */
      const rootKeySet = new Set(rootKeys)
      const expandedKeySet = new Set(currentExpanded)
      const dirtyKeys = store.dirtyTreeKeys.filter(function (key) {
        return rootKeySet.has(key) || expandedKeySet.has(key)
      })
      const hasDirtyInput = store.dirtyTreeKeys.length > 0
      if (hasDirtyInput) store.toClearDirtyTreeKeys()
      // 去重 + 深度优先：先让根出来，超量部分留给下一次 treeRevision
      const keys = (
        hasDirtyInput
          ? dirtyKeys
          : [...rootKeys, ...currentExpanded].filter(function (key, index, list) {
              return list.indexOf(key) === index
            })
      )
        .sort(function (a, b) {
          return countDepth(a) - countDepth(b)
        })
        .slice(0, MAX_REFRESH_KEYS)

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
        const trace = startExplorerOp('refresh', relativePath)
        const startedAt = perfNow()
        // 刷新沿用当前已展开的深度：用户点过「显示更多」就别打回第一页
        const renderedCount = (findFileTreeNode(treeNodesRef.current, key)?.children ?? []).filter(
          function (child) {
            return !child.isLoadMore
          }
        ).length
        void listWorkspaceEntries(root, relativePath, {
          isHiddenVisible,
          offset: 0,
          limit: Math.max(EXPLORER_PAGE_SIZE, renderedCount)
        })
          .then(function (page) {
            if (cancelled) return
            trace.read(perfNow() - startedAt).count(page.entries.length)
            // 刷新只换这一层的前一页，剩下的让「显示更多」继续
            const nextChildren = page.entries.map(function (entry) {
              return toTreeNode(entry, rootIndex)
            })
            const isTruncated = page.isTruncated
            const payload = isTruncated
              ? [...nextChildren, toLoadMoreNode(key, Math.max(page.total - page.nextOffset, 0))]
              : nextChildren
            setTreeNodes(function (origin) {
              return updateFileTreeNodes(origin, key, payload, {
                hasMore: isTruncated,
                nextOffset: page.nextOffset
              })
            })
            trace.settle()
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
        <ExplorerFlatList
          rows={rows}
          rootKey={firstRootKey}
          activeKey={props.activeKey}
          isExpanded={isExpanded}
          onSelect={onSelect}
          onExpandChange={onExpandChange}
        />
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
