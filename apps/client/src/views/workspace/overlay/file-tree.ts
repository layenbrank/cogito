import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-item.tsx'

function updateFileTreeNodes(
  list: FileTreeNode[],
  key: string,
  children: FileTreeNode[],
  meta?: { hasMore?: boolean; nextOffset?: number }
): FileTreeNode[] {
  return list.map(function (node) {
    if (node.key === key) {
      return {
        ...node,
        children,
        isLoaded: true,
        isLoading: false,
        hasMore: meta?.hasMore ?? false,
        nextOffset: meta?.nextOffset ?? children.filter(function (child) {
          return !child.isLoadMore
        }).length
      }
    }
    if (node.children) {
      return {
        ...node,
        children: updateFileTreeNodes(node.children, key, children, meta)
      }
    }
    return node
  })
}

function patchFileTreeNode(
  list: FileTreeNode[],
  key: string,
  patch: Partial<FileTreeNode>
): FileTreeNode[] {
  return list.map(function (node) {
    if (node.key === key) {
      return { ...node, ...patch }
    }
    if (node.children) {
      return {
        ...node,
        children: patchFileTreeNode(node.children, key, patch)
      }
    }
    return node
  })
}

function findFileTreeNode(
  list: FileTreeNode[],
  key: string
): FileTreeNode | null {
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
  return list.map(function (node) {
    if (node.key === key) {
      const withoutSentinel = (node.children ?? []).filter(function (child) {
        return !child.isLoadMore
      })
      return {
        ...node,
        children: [...withoutSentinel, ...extra],
        isLoaded: true,
        isLoading: false,
        hasMore: options.hasMore,
        nextOffset: options.nextOffset
      }
    }
    if (node.children) {
      return {
        ...node,
        children: appendFileTreeChildren(node.children, key, extra, options)
      }
    }
    return node
  })
}

function filterFileTreeNodes(
  list: FileTreeNode[],
  query: string
): FileTreeNode[] {
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
 * 返回 cancel()，在 loadGen 变化或 unmount 时调用。
 */
function scheduleChunkedChildren(
  applyChunk: (chunk: FileTreeNode[], isFirst: boolean, isDone: boolean) => void,
  nodes: FileTreeNode[],
  chunkSize: number = CHUNK_SIZE
): () => void {
  if (nodes.length === 0) {
    applyChunk([], true, true)
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
    applyChunk(next, isFirst, isDone)
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
  updateFileTreeNodes,
  patchFileTreeNode,
  findFileTreeNode,
  appendFileTreeChildren,
  filterFileTreeNodes,
  scheduleChunkedChildren
}
