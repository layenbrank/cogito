import { isFolderSelected, joinPath } from '@/views/bookmark/import/tree'
import type { BookmarkNode } from '@/views/bookmark/import/types'

type ImportNode = {
  title: string
  url?: string
  children?: ImportNode[]
}

/**
 * 按勾选文件夹裁剪导入树：仅保留被选中（或其祖先被选中）的子树。
 */
function pruneImportRoots(roots: BookmarkNode[], selectedFolders: string[]): ImportNode[] {
  const selected = new Set(selectedFolders)
  return pruneChildren(roots, '', selected)
}

function pruneChildren(
  nodes: BookmarkNode[],
  parentPath: string,
  selected: Set<string>
): ImportNode[] {
  const out: ImportNode[] = []
  for (const node of nodes) {
    if (node.url) {
      if (isFolderSelected(parentPath || '未分类', selected)) {
        out.push({ title: node.title, url: node.url })
      }
      continue
    }
    const path = joinPath(parentPath, node.title)
    if (!isFolderSelected(path, selected)) continue
    const children = pruneChildren(node.children ?? [], path, selected)
    out.push({ title: node.title, children })
  }
  return out
}

export { pruneImportRoots }
export type { ImportNode }
