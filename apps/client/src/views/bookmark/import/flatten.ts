import type { BookmarkLeaf, BookmarkNode } from '@/views/bookmark/import/types'

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url.trim())
    parsed.hash = ''
    let href = parsed.href
    if (href.endsWith('/') && parsed.pathname !== '/') {
      href = href.slice(0, -1)
    } else if (href.endsWith('/') && parsed.pathname === '/') {
      // https://example.com/ → https://example.com
      href = href.slice(0, -1)
    }
    return href
  } catch (error) {
    console.warn('[bookmark-import] normalizeUrl 失败', url, error)
    return url.trim()
  }
}

function flattenNodes(
  nodes: BookmarkNode[],
  parentPath: string,
  out: BookmarkLeaf[]
) {
  for (const node of nodes) {
    if (node.url) {
      const path = parentPath || '未分类'
      out.push({
        title: node.title,
        url: normalizeUrl(node.url),
        sourcePath: path
      })
      continue
    }
    const nextPath = parentPath
      ? `${parentPath}/${node.title}`
      : node.title
    flattenNodes(node.children ?? [], nextPath, out)
  }
}

/** 树 → 叶子列表；同 url 保留首次出现 */
function flattenBookmarkLeaves(roots: BookmarkNode[]): BookmarkLeaf[] {
  const leaves: BookmarkLeaf[] = []
  flattenNodes(roots, '', leaves)
  const seen = new Set<string>()
  const unique: BookmarkLeaf[] = []
  for (const leaf of leaves) {
    if (seen.has(leaf.url)) continue
    seen.add(leaf.url)
    unique.push(leaf)
  }
  return unique
}

/** 收集文件夹路径（含中间节点），供勾选 UI */
function collectFolderPaths(nodes: BookmarkNode[], parentPath: string, out: string[]) {
  for (const node of nodes) {
    if (node.url) continue
    const path = parentPath ? `${parentPath}/${node.title}` : node.title
    out.push(path)
    collectFolderPaths(node.children ?? [], path, out)
  }
}

function findFolderPaths(roots: BookmarkNode[]) {
  const paths: string[] = []
  collectFolderPaths(roots, '', paths)
  return paths
}

/** 仅保留 sourcePath 落在已选文件夹（或其自身为选中路径前缀下叶子）的叶子 */
function filterLeavesByFolders(leaves: BookmarkLeaf[], selectedFolders: Set<string>) {
  if (selectedFolders.size === 0) return []
  return leaves.filter(function (leaf) {
    if (selectedFolders.has(leaf.sourcePath)) return true
    for (const folder of selectedFolders) {
      if (leaf.sourcePath === folder || leaf.sourcePath.startsWith(`${folder}/`)) {
        return true
      }
    }
    return false
  })
}

export {
  filterLeavesByFolders,
  findFolderPaths,
  flattenBookmarkLeaves,
  normalizeUrl
}
