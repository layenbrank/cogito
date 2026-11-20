export interface BookmarkNode {
  id: string
  title: string
  url?: string
  children?: BookmarkNode[]
}

export function countBookmarkLinks(node: BookmarkNode): number {
  if (node.url) return 1
  return (node.children ?? []).reduce(function (sum, child) {
    return sum + countBookmarkLinks(child)
  }, 0)
}

export function filterBookmarkTree(nodes: readonly BookmarkNode[], keyword: string): BookmarkNode[] {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return nodes.slice()

  const next: BookmarkNode[] = []

  for (const node of nodes) {
    const haystack = `${node.title} ${node.url ?? ''}`.toLowerCase()
    const self = haystack.includes(normalized)
    if (self) {
      next.push(node)
      continue
    }

    const children = node.children ? filterBookmarkTree(node.children, normalized) : []
    if (children.length > 0) next.push({ ...node, children })
  }

  return next
}

export function fetchBookmarkTree(): Promise<BookmarkNode[]> {
  const bookmarks = globalThis.chrome?.bookmarks
  if (!bookmarks) return Promise.resolve([])

  return bookmarks.getTree()
}
