/**
 * Code 工作区 · Explorer 可见行扁平化（纯函数）。
 *
 * 树是「根 + 已展开节点」的递归结构，虚拟滚动需要的是一维的、等高的行数组。
 * 这里只做两件事：按展开态把树压平，以及按滚动位置算出要渲染的行窗口。
 * 不碰 React、不碰 DOM，便于单测。
 */
import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-node.ts'

type ExplorerRowKind = 'file' | 'directory' | 'loadMore' | 'empty'

interface ExplorerRow {
  /** 渲染列表用的稳定 key（空提示行带后缀，避免与节点 key 撞车） */
  key: string
  /** 对应的树节点 key：点击、右键、高亮都走它 */
  nodeKey: string
  depth: number
  kind: ExplorerRowKind
  node: FileTreeNode
}

const EMPTY_ROW_SUFFIX = '::__empty__'

/** 目录判定与渲染层保持一致：`isDirectory ?? !isLeaf`，加载更多哨兵不是目录 */
function isDirectoryNode(node: FileTreeNode): boolean {
  if (node.isLoadMore) return false
  return node.isDirectory ?? !node.isLeaf
}

function toRowKind(node: FileTreeNode): ExplorerRowKind {
  if (node.isLoadMore) return 'loadMore'
  return isDirectoryNode(node) ? 'directory' : 'file'
}

/**
 * 把树压成一维行：只展开 `expandedKeys` 里的目录。
 *
 * 「显示更多」哨兵是普通的子节点，自然排在那一层的末尾；空目录在展开后补一行
 * 空提示（否则展开一个空目录毫无反馈）。
 */
function flattenExplorerRows(
  nodes: readonly FileTreeNode[],
  expandedKeys: ReadonlySet<string>,
  depth = 0
): ExplorerRow[] {
  const rows: ExplorerRow[] = []
  for (const node of nodes) {
    rows.push({ key: node.key, nodeKey: node.key, depth, kind: toRowKind(node), node })
    if (!isDirectoryNode(node)) continue
    if (!expandedKeys.has(node.key)) continue
    const children = node.children ?? []
    if (children.length > 0) {
      const nested = flattenExplorerRows(children, expandedKeys, depth + 1)
      for (const row of nested) rows.push(row)
      continue
    }
    if (node.isLoaded) {
      rows.push({
        key: `${node.key}${EMPTY_ROW_SUFFIX}`,
        nodeKey: node.key,
        depth: depth + 1,
        kind: 'empty',
        node
      })
    }
  }
  return rows
}

interface RowWindow {
  /** 渲染区间：[start, end) */
  start: number
  end: number
  /** 上 / 下占位高度，让滚动条总长度等于「总行数 × 行高」 */
  topHeight: number
  bottomHeight: number
}

interface RowWindowParams {
  total: number
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  /** 需要保证落在窗口内的行（当前活动文件），不要求一定渲染，但至少要可见 */
  activeIndex?: number
  /** 视口上下各多渲染几行，避免快速滚动时露白 */
  overscan?: number
}

/**
 * 按滚动位置算渲染窗口。
 *
 * 行高固定，所以 `start = floor(scrollTop / rowHeight)`；活动行在窗口外时把窗口
 * 拉过去（一次多渲染一行，比再算一次滚动位置简单且不会抖）。
 */
function computeRowWindow(params: RowWindowParams): RowWindow {
  const rowHeight = Math.max(params.rowHeight, 1)
  const total = Math.max(params.total, 0)
  if (total === 0) return { start: 0, end: 0, topHeight: 0, bottomHeight: 0 }

  const overscan = Math.max(params.overscan ?? 0, 0)
  const visible = Math.max(params.viewportHeight, rowHeight)
  const scrollTop = Math.max(params.scrollTop, 0)

  let start = Math.floor(scrollTop / rowHeight) - overscan
  let end = Math.ceil((scrollTop + visible) / rowHeight) + overscan
  start = Math.max(0, Math.min(start, total - 1))
  end = Math.max(start + 1, Math.min(end, total))

  const activeIndex = params.activeIndex ?? -1
  if (activeIndex >= 0 && activeIndex < total) {
    if (activeIndex < start) start = activeIndex
    if (activeIndex >= end) end = activeIndex + 1
  }

  return {
    start,
    end,
    topHeight: start * rowHeight,
    bottomHeight: (total - end) * rowHeight
  }
}

/** 活动文件在行数组里的下标；找不到（未展开 / 不在工作区）返回 -1 */
function findExplorerRowIndex(rows: readonly ExplorerRow[], nodeKey: string | null): number {
  if (!nodeKey) return -1
  const normalized = nodeKey.replace(/\\/g, '/').toLowerCase()
  for (let index = 0; index < rows.length; index += 1) {
    const candidate = rows[index].nodeKey.replace(/\\/g, '/').toLowerCase()
    if (candidate === normalized) return index
  }
  return -1
}

export { EMPTY_ROW_SUFFIX, computeRowWindow, findExplorerRowIndex, flattenExplorerRows, isDirectoryNode }
export type { ExplorerRow, ExplorerRowKind, RowWindow, RowWindowParams }
