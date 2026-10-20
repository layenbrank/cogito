import type { BookmarkLeaf, BookmarkNode } from '@/views/bookmark/import/types'
import { flattenBookmarkLeaves, normalizeUrl } from '@/views/bookmark/import/flatten'

/** 路径段 → 完整路径 */
function joinPath(parent: string, title: string) {
  return parent ? `${parent}/${title}` : title
}

/** 列出某路径下的直接子节点；path 空串 = 根 */
function findChildrenAtPath(roots: BookmarkNode[], path: string): BookmarkNode[] {
  if (!path) return roots
  const segments = path.split('/').filter(Boolean)
  let nodes = roots
  for (const segment of segments) {
    const folder = nodes.find(function (node) {
      return !node.url && node.title === segment
    })
    if (!folder) return []
    nodes = folder.children ?? []
  }
  return nodes
}

/** 某路径对应的文件夹节点 */
function findFolderAtPath(roots: BookmarkNode[], path: string): BookmarkNode | null {
  if (!path) return null
  const segments = path.split('/').filter(Boolean)
  let nodes = roots
  let folder: BookmarkNode | null = null
  for (const segment of segments) {
    folder =
      nodes.find(function (node) {
        return !node.url && node.title === segment
      }) ?? null
    if (!folder) return null
    nodes = folder.children ?? []
  }
  return folder
}

/** 路径的所有祖先（含自身），由浅到深 */
function findAncestorPaths(path: string): string[] {
  if (!path) return []
  const parts = path.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < parts.length; i += 1) {
    out.push(parts.slice(0, i + 1).join('/'))
  }
  return out
}

function findFolderTitle(path: string) {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

/** 默认勾选「书签栏」顶层；没有则勾选全部顶层文件夹 */
function findDefaultSelectedFolders(roots: BookmarkNode[]) {
  const hasBar = roots.some(function (node) {
    return !node.url && node.title === '书签栏'
  })
  if (hasBar) return ['书签栏']
  return roots
    .filter(function (node) {
      return !node.url
    })
    .map(function (node) {
      return node.title
    })
}

/** 文件夹是否被选中（自身或祖先被勾选） */
function isFolderSelected(path: string, selectedFolders: Set<string>) {
  if (selectedFolders.has(path)) return true
  for (const selected of selectedFolders) {
    if (path === selected || path.startsWith(`${selected}/`)) return true
  }
  return false
}

function isLeafSelected(leaf: BookmarkLeaf, selectedFolders: Set<string>) {
  return isFolderSelected(leaf.sourcePath, selectedFolders)
}

function findSelectedLeaves(leaves: BookmarkLeaf[], selectedFolders: string[]) {
  const set = new Set(selectedFolders)
  return leaves.filter(function (leaf) {
    return isLeafSelected(leaf, set)
  })
}

/**
 * 选中叶子所需的全部文件夹路径（含中间层），浅→深排序。
 */
function findRequiredFolderPaths(leaves: BookmarkLeaf[]) {
  const set = new Set<string>()
  for (const leaf of leaves) {
    for (const path of findAncestorPaths(leaf.sourcePath)) {
      set.add(path)
    }
  }
  return [...set].toSorted(function (a, b) {
    const depth = a.split('/').length - b.split('/').length
    if (depth !== 0) return depth
    return a.localeCompare(b, 'zh')
  })
}

function countFolderLinks(roots: BookmarkNode[], path: string) {
  const folder = findFolderAtPath(roots, path)
  if (!folder) return 0
  return flattenBookmarkLeaves([folder]).length
}

export {
  countFolderLinks,
  findAncestorPaths,
  findChildrenAtPath,
  findDefaultSelectedFolders,
  findFolderAtPath,
  findFolderTitle,
  findRequiredFolderPaths,
  findSelectedLeaves,
  isFolderSelected,
  isLeafSelected,
  joinPath,
  normalizeUrl
}
