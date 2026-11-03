/**
 * Code 工作区 · 侧栏文件树辅助类型与纯函数。
 *
 * 多根工作区下 key 统一为 `<rootIndex>::<relativePath>`：
 * 根节点是 `0::` / `1::`，既避免同名相对路径串根，也让右键菜单能还原所属根。
 */
import { joinPath, type TreeEntry } from '@/views/code/lib/fs.ts'
import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-item.tsx'

/** 主根（索引 0）的 key；保留给旧调用点 */
export const EXPLORER_ROOT_KEY = '0::'

export type ExplorerCreateKind = 'file' | 'folder'

export interface ExplorerNewTarget {
  kind: ExplorerCreateKind
  /** 根索引（决定文件落到哪个根） */
  rootIndex: number
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

function makeTreeKey(rootIndex: number, relativePath: string): string {
  return `${rootIndex}::${relativePath}`
}

function parseTreeKey(key: string): { rootIndex: number; relativePath: string } {
  const index = key.indexOf('::')
  if (index < 0) return { rootIndex: 0, relativePath: key }
  const parsed = Number(key.slice(0, index))
  return {
    rootIndex: Number.isFinite(parsed) ? parsed : 0,
    relativePath: key.slice(index + 2)
  }
}

function findRelativeDirForCreate(treeKey: string, isDirectory: boolean): string {
  const { relativePath } = parseTreeKey(treeKey)
  if (!relativePath) return ''
  if (isDirectory) return relativePath
  const parent = relativePath.replace(/[/\\][^/\\]+$/, '')
  return parent === relativePath ? '' : parent
}

function findAbsoluteFromKey(roots: string[], treeKey: string): string {
  const { rootIndex, relativePath } = parseTreeKey(treeKey)
  const root = roots[rootIndex] ?? roots[0]
  if (!root) return ''
  if (!relativePath) return root
  return joinPath(root, relativePath)
}

function toTreeNode(entry: TreeEntry, rootIndex: number): FileTreeNode {
  return {
    title: entry.name,
    key: makeTreeKey(rootIndex, entry.path),
    isLeaf: !entry.isDirectory,
    isDirectory: entry.isDirectory
  }
}

/** 层级深度：相对路径段数；根为 0 */
function countDepth(key: string): number {
  const { relativePath } = parseTreeKey(key)
  if (!relativePath) return 0
  return relativePath.split('/').filter(Boolean).length + 1
}

/** 丢弃未展开目录的子节点缓存，下次展开时按需重读 */
function pruneCollapsedNodes(
  nodes: FileTreeNode[],
  expandedKeys: Set<string>
): FileTreeNode[] {
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

export {
  makeTreeKey,
  parseTreeKey,
  findRelativeDirForCreate,
  findAbsoluteFromKey,
  toTreeNode,
  countDepth,
  pruneCollapsedNodes
}
