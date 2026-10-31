interface FileTreeNode {
  title: string
  key: string
  isLeaf?: boolean
  isDirectory?: boolean
  isLoaded?: boolean
  isLoading?: boolean
  hasMore?: boolean
  isLoadMore?: boolean
  nextOffset?: number
  children?: FileTreeNode[]
}

export type { FileTreeNode }
