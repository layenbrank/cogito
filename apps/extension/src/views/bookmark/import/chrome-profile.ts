import type { BookmarkNode } from '@/views/bookmark/import/types'

interface ChromeProfileBookmarks {
  label: string
  path: string
  roots: BookmarkNode[]
}

const ROOT_TITLE: Record<string, string> = {
  '1': '书签栏',
  '2': '其他书签',
  '3': '移动设备书签'
}

function mapChromeNode(node: chrome.bookmarks.BookmarkTreeNode): BookmarkNode | null {
  const title = node.title.trim() || ROOT_TITLE[node.id] || '未命名'
  if (node.url) {
    if (/^(javascript|data|vbscript):/i.test(node.url)) return null
    return { id: `chrome-${node.id}`, title: title || node.url, url: node.url }
  }

  const children: BookmarkNode[] = []
  for (const child of node.children ?? []) {
    const parsed = mapChromeNode(child)
    if (parsed) children.push(parsed)
  }
  return { id: `chrome-${node.id}`, title, children }
}

/** 扩展里的「本机 Profile」就是当前浏览器的书签树。 */
async function discoverChromeProfiles(): Promise<ChromeProfileBookmarks[]> {
  const tree = await chrome.bookmarks.getTree()
  const root = tree[0]
  const roots = (root?.children ?? [])
    .map(function (node) {
      return mapChromeNode(node)
    })
    .filter(function (node): node is BookmarkNode {
      return node !== null
    })
  if (!roots.length) return []
  return [{ label: '当前浏览器', path: 'chrome.bookmarks', roots }]
}

export { discoverChromeProfiles }
export type { ChromeProfileBookmarks }
