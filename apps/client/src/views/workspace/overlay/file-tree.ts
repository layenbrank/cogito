import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-item.tsx'

/**
 * 树的**结构化共享**更新。
 *
 * 旧实现每层 `map` 都 `{ ...node, children }`，于是「刷新一个目录」会把所有带
 * children 的节点都换成新对象 —— `FileTreeItem` 的 memo 按 `node` 引用比较，
 * 整棵已展开子树因此全量重渲染（展开 `node_modules` 时就是上千行）。
 *
 * 现在的约定：
 * - 目标 key 不在该子树里 → **原样返回同一个引用**（`list` 本身也不换）；
 * - 目标 key 在子树里 → 只克隆从根到目标这条路径上的节点；
 * - 什么都没变 → 返回入参 `list`，`setState` 直接短路。
 */
function updateFileTreeNodes(
  list: FileTreeNode[],
  key: string,
  children: FileTreeNode[],
  meta?: { hasMore?: boolean; nextOffset?: number }
): FileTreeNode[] {
  let isChanged = false
  const next = list.map(function (node) {
    if (node.key === key) {
      isChanged = true
      return {
        ...node,
        children,
        isLoaded: true,
        isLoading: false,
        hasMore: meta?.hasMore ?? false,
        nextOffset:
          meta?.nextOffset ??
          children.filter(function (child) {
            return !child.isLoadMore
          }).length
      }
    }
    if (!node.children) return node
    const nextChildren = updateFileTreeNodes(node.children, key, children, meta)
    if (nextChildren === node.children) return node
    isChanged = true
    return { ...node, children: nextChildren }
  })
  return isChanged ? next : list
}

function patchFileTreeNode(
  list: FileTreeNode[],
  key: string,
  patch: Partial<FileTreeNode>
): FileTreeNode[] {
  let isChanged = false
  const next = list.map(function (node) {
    if (node.key === key) {
      isChanged = true
      return { ...node, ...patch }
    }
    if (!node.children) return node
    const nextChildren = patchFileTreeNode(node.children, key, patch)
    if (nextChildren === node.children) return node
    isChanged = true
    return { ...node, children: nextChildren }
  })
  return isChanged ? next : list
}

function findFileTreeNode(list: FileTreeNode[], key: string): FileTreeNode | null {
  for (const node of list) {
    if (node.key === key) return node
    if (node.children) {
      const found = findFileTreeNode(node.children, key)
      if (found) return found
    }
  }
  return null
}

/** 追加子节点（用于 Load more），并更新 hasMore / nextOffset */
function appendFileTreeChildren(
  list: FileTreeNode[],
  key: string,
  extra: FileTreeNode[],
  options: { hasMore: boolean; nextOffset: number }
): FileTreeNode[] {
  let isChanged = false
  const next = list.map(function (node) {
    if (node.key === key) {
      isChanged = true
      const withoutSentinel = (node.children ?? []).filter(function (child) {
        return !child.isLoadMore
      })
      return {
        ...node,
        children: extra.length > 0 ? [...withoutSentinel, ...extra] : withoutSentinel,
        isLoaded: true,
        isLoading: false,
        hasMore: options.hasMore,
        nextOffset: options.nextOffset
      }
    }
    if (!node.children) return node
    const nextChildren = appendFileTreeChildren(node.children, key, extra, options)
    if (nextChildren === node.children) return node
    isChanged = true
    return { ...node, children: nextChildren }
  })
  return isChanged ? next : list
}

/**
 * 丢掉某层目录的子节点缓存（折叠时用）。
 *
 * 折叠 = 这份缓存不再被看见，留着只是占内存；下次展开按需重读。
 * 未命中的分支保持同一引用，不制造无谓重渲染。
 */
function dropFileTreeChildren(list: FileTreeNode[], key: string): FileTreeNode[] {
  let isChanged = false
  const next = list.map(function (node) {
    if (node.key === key) {
      if (!node.children && !node.isLoaded) return node
      isChanged = true
      return {
        ...node,
        children: undefined,
        isLoaded: false,
        isLoading: false,
        hasMore: false,
        nextOffset: 0
      }
    }
    if (!node.children) return node
    const nextChildren = dropFileTreeChildren(node.children, key)
    if (nextChildren === node.children) return node
    isChanged = true
    return { ...node, children: nextChildren }
  })
  return isChanged ? next : list
}

function filterFileTreeNodes(list: FileTreeNode[], query: string): FileTreeNode[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return list

  return list
    .map(function (node) {
      if (node.isLoadMore) return node
      const titleMatch = node.title.toLowerCase().includes(normalized)
      const filteredChildren = node.children
        ? filterFileTreeNodes(node.children, normalized)
        : undefined
      const hasChildMatch = Boolean(filteredChildren && filteredChildren.length > 0)
      if (!titleMatch && !hasChildMatch && node.isLeaf) return null
      if (!titleMatch && !hasChildMatch && !node.isDirectory && !node.children) {
        return null
      }
      if (node.isDirectory || !node.isLeaf) {
        if (!titleMatch && !hasChildMatch) return null
        return {
          ...node,
          children: filteredChildren
        }
      }
      return titleMatch ? node : null
    })
    .filter(function (node): node is FileTreeNode {
      return node !== null
    })
}

const CHUNK_SIZE = 50

/**
 * 分帧追加子节点。首批同步写入，其余用 rAF。
 * 返回 cancel()，在 fetchGen 变化或 unmount 时调用。
 */
function scheduleChunkedChildren(
  writeChunk: (chunk: FileTreeNode[], isFirst: boolean, isDone: boolean) => void,
  nodes: FileTreeNode[],
  chunkSize: number = CHUNK_SIZE
): () => void {
  if (nodes.length === 0) {
    writeChunk([], true, true)
    return function () {}
  }

  let cancelled = false
  let offset = 0
  let rafId = 0

  function pump() {
    if (cancelled) return
    const isFirst = offset === 0
    const next = nodes.slice(offset, offset + chunkSize)
    offset += next.length
    const isDone = offset >= nodes.length
    writeChunk(next, isFirst, isDone)
    if (!isDone) {
      rafId = requestAnimationFrame(pump)
    }
  }

  pump()

  return function cancel() {
    cancelled = true
    if (rafId) cancelAnimationFrame(rafId)
  }
}

export {
  CHUNK_SIZE,
  appendFileTreeChildren,
  dropFileTreeChildren,
  filterFileTreeNodes,
  findFileTreeNode,
  patchFileTreeNode,
  scheduleChunkedChildren,
  updateFileTreeNodes
}
