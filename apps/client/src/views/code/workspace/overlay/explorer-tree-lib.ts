/**
 * Code 工作区 · 侧栏文件树辅助类型与纯函数
 */
import { joinPath, type TreeEntry } from '@/views/code/lib/fs.ts'
import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-item.tsx'

export const EXPLORER_ROOT_KEY = 'ROOT'

export type ExplorerCreateKind = 'file' | 'folder'

export interface ExplorerNewTarget {
  kind: ExplorerCreateKind
  relativeDir: string
  name: string
}

export interface ExplorerRenameTarget {
  absolute: string
  name: string
  isDirectory: boolean
}

export interface ExplorerDeleteTarget {
  absolute: string
  isDirectory: boolean
}

function findRelativeDirForCreate(treeKey: string, isDirectory: boolean): string {
  if (treeKey === EXPLORER_ROOT_KEY) return ''
  if (isDirectory) return treeKey
  const parent = treeKey.replace(/[/\\][^/\\]+$/, '')
  return parent === treeKey ? '' : parent
}

function findAbsoluteFromKey(root: string, treeKey: string): string {
  if (treeKey === EXPLORER_ROOT_KEY) return root
  return joinPath(root, treeKey)
}

function toTreeNode(entry: TreeEntry): FileTreeNode {
  return {
    title: entry.name,
    key: entry.path,
    isLeaf: !entry.isDirectory,
    isDirectory: entry.isDirectory
  }
}

/** 层级深度：用于让父目录先于子目录重读 */
function countDepth(key: string): number {
  if (key === EXPLORER_ROOT_KEY) return 0
  return key.split('/').length
}

/** 丢弃未展开目录的子节点缓存，下次展开时按需重读 */
function pruneCollapsedNodes(nodes: FileTreeNode[], expandedKeys: Set<string>): FileTreeNode[] {
  return nodes.map(function (node) {
    if (!node.children) return node
    const isExpanded = expandedKeys.has(node.key)
    return {
      ...node,
      children: isExpanded ? pruneCollapsedNodes(node.children, expandedKeys) : undefined,
      isLoaded: isExpanded ? node.isLoaded : false
    }
  })
}
export { findRelativeDirForCreate, findAbsoluteFromKey, toTreeNode, countDepth, pruneCollapsedNodes }
