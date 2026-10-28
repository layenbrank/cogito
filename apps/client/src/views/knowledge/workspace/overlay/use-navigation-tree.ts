/**
 * 导航树的加载与选择：分帧灌入子节点、维护展开集合、把相对 key 解析成绝对路径。
 */
import { resolve } from '@tauri-apps/api/path'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  TREE_PAGE_SIZE,
  clearDirListCache,
  isForbiddenPathError,
  listMarkdownEntries,
  type TreeEntry
} from '@/views/knowledge/lib/fs.ts'
import { normalizeSeparators } from '@/views/knowledge/lib/path.ts'
import { openFolderAsWorkspace } from '@/views/knowledge/lib/session.ts'
import { t } from '@/views/knowledge/locale.ts'
import { type FileTreeNode } from '@/views/workspace/overlay/file-tree-item.tsx'
import {
  appendFileTreeChildren,
  filterFileTreeNodes,
  findFileTreeNode,
  patchFileTreeNode,
  scheduleChunkedChildren,
  updateFileTreeNodes
} from '@/views/workspace/overlay/file-tree.ts'

const ROOT_KEY = 'ROOT'

function findLoadMoreKey(parentKey: string) {
  return `${parentKey}::__load_more`
}

function mapEntriesToNodes(
  entries: TreeEntry[],
  parentKey: string,
  hasMore: boolean,
  nextOffset: number
): FileTreeNode[] {
  const nodes: FileTreeNode[] = entries.map(function (entry) {
    return {
      title: entry.name,
      key: entry.path,
      isLeaf: !entry.isDirectory,
      isDirectory: entry.isDirectory,
      isLoaded: false
    }
  })
  if (hasMore) {
    nodes.push({
      title: t('LOAD_MORE'),
      key: findLoadMoreKey(parentKey),
      isLeaf: true,
      isLoadMore: true,
      nextOffset
    })
  }
  return nodes
}

function findRelativeKeyFromAbsolute(root: string, absolute: string): string | null {
  const rootNorm = normalizeSeparators(root).replace(/\/+$/, '')
  const absNorm = normalizeSeparators(absolute).replace(/\/+$/, '')
  const rootCmp = rootNorm.toLowerCase()
  const absCmp = absNorm.toLowerCase()
  if (absCmp === rootCmp) return ROOT_KEY
  if (!absCmp.startsWith(`${rootCmp}/`)) return null
  return absNorm.slice(rootNorm.length + 1)
}

export function useNavigationTree(input: {
  rootDir: string | null
  activePath: string | null
  treeRevision: number
  rootTitle: string
  fileQuery: string
  onOpenPath: (path: string) => void
}) {
  const { rootDir, activePath, treeRevision, rootTitle, fileQuery } = input

  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([
    {
      title: rootTitle,
      key: ROOT_KEY,
      isDirectory: true,
      isLoaded: false,
      isLoading: false
    }
  ])
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(function () {
    return new Set([ROOT_KEY])
  })

  // render 期写 ref 会被 React 19 判为「渲染期改 ref」；这里只在异步回调里读，故放到 layout effect 同步
  const treeNodesRef = useRef(treeNodes)
  useLayoutEffect(
    function () {
      treeNodesRef.current = treeNodes
    },
    [treeNodes]
  )

  const loadGenRef = useRef(0)
  const cancelChunkRef = useRef<(() => void) | null>(null)
  const absolutePathCacheRef = useRef(new Map<string, string>())

  const activeKey = useMemo(
    function () {
      if (!activePath || !rootDir) return null
      return findRelativeKeyFromAbsolute(rootDir, activePath)
    },
    [activePath, rootDir]
  )

  // 搜索只做客户端过滤，不再 force readDir
  const visibleNodes = useMemo(
    function () {
      const query = fileQuery.trim()
      if (!query) return treeNodes
      return filterFileTreeNodes(treeNodes, query)
    },
    [treeNodes, fileQuery]
  )

  function cancelPendingChunk() {
    cancelChunkRef.current?.()
    cancelChunkRef.current = null
  }

  const loadChildren = useCallback(async function (
    node: FileTreeNode,
    options: { force?: boolean; append?: boolean } = {}
  ) {
    const current = findFileTreeNode(treeNodesRef.current, node.key) ?? node
    // force 必须能打断「预置 isLoading / 上一代未 settle」的假加载，否则 ROOT 会永久骨架
    if (current.isLoading && !options.force) return
    if (current.isLoaded && !options.force && !options.append) return

    const gen = ++loadGenRef.current
    cancelPendingChunk()

    setTreeNodes(function (origin) {
      return patchFileTreeNode(origin, node.key, { isLoading: true })
    })

    try {
      // 侧栏根必须来自调用方；禁止在这里 ensure 出 default 库目录
      const root = rootDir
      if (!root) {
        setTreeNodes(function (origin) {
          return patchFileTreeNode(origin, node.key, {
            isLoading: false,
            isLoaded: true,
            children: []
          })
        })
        return
      }
      if (gen !== loadGenRef.current) return

      const relative = node.key === ROOT_KEY ? '' : node.key
      const offset = options.append
        ? (current.nextOffset ??
          current.children?.filter(function (child) {
            return !child.isLoadMore
          }).length ??
          0)
        : 0

      const result = await listMarkdownEntries(root, relative, {
        offset,
        limit: TREE_PAGE_SIZE
      })
      if (gen !== loadGenRef.current) return

      const nextOffset = offset + result.entries.length
      const mapped = mapEntriesToNodes(result.entries, node.key, result.hasMore, nextOffset)

      if (options.append) {
        setTreeNodes(function (origin) {
          return appendFileTreeChildren(origin, node.key, mapped, {
            hasMore: result.hasMore,
            nextOffset
          })
        })
        return
      }

      // 首批立即上屏，其余分帧追加；完成后再挂 Load more 哨兵
      // 空目录也走 scheduleChunkedChildren（空数组同步 apply），以清 isLoading
      const contentNodes = mapped.filter(function (item) {
        return !item.isLoadMore
      })
      const sentinel = mapped.find(function (item) {
        return item.isLoadMore
      })
      let painted = 0

      cancelChunkRef.current = scheduleChunkedChildren(function (chunk, isFirst, isDone) {
        if (gen !== loadGenRef.current) return
        painted += chunk.length
        const finalExtra = isDone && sentinel ? [...chunk, sentinel] : chunk
        setTreeNodes(function (origin) {
          if (isFirst) {
            return updateFileTreeNodes(origin, node.key, finalExtra, {
              hasMore: isDone ? result.hasMore : false,
              nextOffset: isDone ? nextOffset : painted
            })
          }
          return appendFileTreeChildren(origin, node.key, finalExtra, {
            hasMore: isDone ? result.hasMore : false,
            nextOffset: isDone ? nextOffset : painted
          })
        })
      }, contentNodes)
    } catch (error) {
      if (gen !== loadGenRef.current) return
      console.error('[markdown] tree load failed', error)
      setTreeNodes(function (origin) {
        return patchFileTreeNode(origin, node.key, {
          isLoading: false,
          isLoaded: false
        })
      })
      if (isForbiddenPathError(error)) {
        toast.error(t('TREE_FORBIDDEN'), {
          action: {
            label: t('CHOOSE_FOLDER'),
            onClick: function () {
              void openFolderAsWorkspace()
            }
          }
        })
        return
      }
      toast.error(t('OPEN_FAILED'))
    }
  }, [rootDir])

  // 工作区根 / revision：清缓存并 reload ROOT（分帧灌入）
  useEffect(
    function () {
      clearDirListCache()
      absolutePathCacheRef.current.clear()
      cancelPendingChunk()
      loadGenRef.current += 1

      // 不预置 isLoading：由 loadChildren 置位。预置 true 会与「isLoading 则 return」互锁，骨架永不结束
      setTreeNodes([
        {
          title: rootTitle,
          key: ROOT_KEY,
          isDirectory: true,
          isLoaded: false,
          isLoading: false
        }
      ])
      setExpandedKeys(function (prev) {
        const next = new Set(prev)
        next.add(ROOT_KEY)
        return next
      })

      // 无工作区根时不 ensureRootDir：否则会把空的 default 库目录塞进侧栏
      if (!rootDir) return function () {
        cancelPendingChunk()
      }

      void loadChildren(
        { title: rootTitle, key: ROOT_KEY, isDirectory: true },
        { force: true }
      )

      return function () {
        cancelPendingChunk()
      }
    },
    [rootDir, treeRevision, rootTitle, loadChildren]
  )

  // 恢复上次文件后：展开祖先目录并按需灌入，避免只看见根文件夹
  useEffect(
    function () {
      if (!activeKey || activeKey === ROOT_KEY) return
      const segments = normalizeSeparators(activeKey).split('/').filter(Boolean)
      if (segments.length < 2) return

      const ancestorKeys: string[] = []
      let acc = ''
      for (let i = 0; i < segments.length - 1; i += 1) {
        acc = acc ? `${acc}/${segments[i]}` : segments[i]
        ancestorKeys.push(acc)
      }

      setExpandedKeys(function (prev) {
        let changed = !prev.has(ROOT_KEY)
        const next = new Set(prev)
        next.add(ROOT_KEY)
        for (const key of ancestorKeys) {
          if (!next.has(key)) {
            next.add(key)
            changed = true
          }
        }
        return changed ? next : prev
      })

      const pending = ancestorKeys.find(function (key) {
        const node = findFileTreeNode(treeNodes, key)
        return Boolean(node && !node.isLoaded && !node.isLoading)
      })
      if (!pending) return
      const node = findFileTreeNode(treeNodes, pending)
      if (node) void loadChildren(node)
    },
    [activeKey, loadChildren, treeNodes]
  )

  const onExpandChange = useCallback(function (key: string, open: boolean) {
    setExpandedKeys(function (prev) {
      const next = new Set(prev)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const onOpenPathRef = useRef(input.onOpenPath)
  useLayoutEffect(
    function () {
      onOpenPathRef.current = input.onOpenPath
    },
    [input.onOpenPath]
  )

  const onSelect = useCallback(
    function (node: FileTreeNode) {
      if (node.key === ROOT_KEY) return

      if (node.isLoadMore) {
        const parentKey = node.key.replace(/::__load_more$/, '')
        const parent = findFileTreeNode(treeNodesRef.current, parentKey)
        if (parent) void loadChildren(parent, { append: true })
        return
      }

      if (node.isDirectory || !node.isLeaf) return

      void (async function () {
        const cached = absolutePathCacheRef.current.get(node.key)
        if (cached) {
          onOpenPathRef.current(cached)
          return
        }
        if (!rootDir) return
        const segments = normalizeSeparators(node.key).split('/').filter(Boolean)
        const absolute = await resolve(rootDir, ...segments)
        absolutePathCacheRef.current.set(node.key, absolute)
        onOpenPathRef.current(absolute)
      })()
    },
    [loadChildren, rootDir]
  )

  function clearAbsolutePathCache() {
    absolutePathCacheRef.current.clear()
  }

  return {
    nodes: visibleNodes,
    activeKey,
    expandedKeys,
    loadChildren,
    onSelect,
    onExpandChange,
    clearAbsolutePathCache
  }
}

export { ROOT_KEY }
