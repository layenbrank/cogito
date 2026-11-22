/**
 * Chrome Profile `Bookmarks` JSON 解析。
 */
import type { BookmarkNode } from '@/views/bookmark/import/types'

interface ChromeNode {
  name?: string
  type?: string
  url?: string
  children?: ChromeNode[]
  id?: string
}

interface ChromeRoots {
  bookmark_bar?: ChromeNode
  other?: ChromeNode
  synced?: ChromeNode
}

interface ChromeBookmarksFile {
  roots?: ChromeRoots
}

let nodeSeq = 0

function nextId(prefix: string) {
  nodeSeq += 1
  return `${prefix}-${nodeSeq}`
}

function parseChromeNode(node: ChromeNode, fallbackTitle: string): BookmarkNode | null {
  const title = (node.name ?? fallbackTitle).trim() || fallbackTitle
  const type = node.type ?? (node.url ? 'url' : 'folder')

  if (type === 'url' || node.url) {
    const url = node.url?.trim()
    if (!url || /^(javascript|data|vbscript):/i.test(url)) return null
    return {
      id: node.id ? `chrome-${node.id}` : nextId('url'),
      title: title || url,
      url
    }
  }

  const children: BookmarkNode[] = []
  for (const child of node.children ?? []) {
    const parsed = parseChromeNode(child, '未命名')
    if (parsed) children.push(parsed)
  }

  return {
    id: node.id ? `chrome-${node.id}` : nextId('folder'),
    title,
    children
  }
}

function parseChromeBookmarksJson(raw: string): BookmarkNode[] {
  nodeSeq = 0
  const data = JSON.parse(raw) as ChromeBookmarksFile
  const roots = data.roots
  if (!roots) return []

  const nodes: BookmarkNode[] = []
  const pairs: Array<[ChromeNode | undefined, string]> = [
    [roots.bookmark_bar, '书签栏'],
    [roots.other, '其他书签'],
    [roots.synced, '移动设备书签']
  ]

  for (const [root, label] of pairs) {
    if (!root) continue
    const parsed = parseChromeNode(root, label)
    if (!parsed) continue
    // Chrome 根节点本身是文件夹；若名称为空则用中文标签
    if (!parsed.title) parsed.title = label
    nodes.push(parsed)
  }

  return nodes
}

export { parseChromeBookmarksJson }
