/**
 * Code 工作区 · 侧栏文件树辅助类型与纯函数。
 *
 * 多根工作区下 key 统一为 `<rootIndex>::<relativePath>`：
 * 根节点是 `0::` / `1::`，既避免同名相对路径串根，也让右键菜单能还原所属根。
 */
import { joinPath, type TreeEntry } from '@/views/code/lib/fs.ts'
import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-item.tsx'

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

/**
 * `candidate` 是否是 `parent` 的后代（不含自身）。
 *
 * 根 key 形如 `0::`，后代是 `0::src`（前缀即整段）；普通目录 `0::src` 的后代
 * 是 `0::src/xxx`，必须以 `/` 分隔，避免 `src2` 被误判成 `src` 的后代。
 */
function isDescendantTreeKey(parent: string, candidate: string): boolean {
  if (candidate === parent) return false
  if (parent.endsWith('::')) return candidate.startsWith(parent)
  return candidate.startsWith(`${parent}/`)
}

/**
 * 折叠子树时同步丢掉展开态：`parent` 及其全部后代。
 *
 * 不同步丢的话会留下「已展开但没有子节点」的脏 key —— 收起再展开时那几层
 * 既不会被 onOpenChange 触发重读，也匹配不到任何已加载数据，表现为「空目录」。
 */
function dropExpandedSubtree(keys: readonly string[], parent: string): string[] {
  const next = keys.filter(function (key) {
    return key !== parent && !isDescendantTreeKey(parent, key)
  })
  return next.length === keys.length ? keys.slice() : next
}

export {
  makeTreeKey,
  parseTreeKey,
  findRelativeDirForCreate,
  findAbsoluteFromKey,
  toTreeNode,
  countDepth,
  isDescendantTreeKey,
  dropExpandedSubtree
}
