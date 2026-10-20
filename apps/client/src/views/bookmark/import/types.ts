/** 统一中间树：文件夹无 url，叶子有 url */
interface BookmarkNode {
  id: string
  title: string
  url?: string
  children?: BookmarkNode[]
  /** 入库后的排序元数据 */
  index?: number
  updatedAt?: number
}

/** 展平后的可导入链接 */
interface BookmarkLeaf {
  title: string
  url: string
  /** 如 `书签栏/工作` */
  sourcePath: string
}

type DuplicateStrategy = 'skip' | 'overwrite'

interface ImportPreview {
  roots: BookmarkNode[]
  leaves: BookmarkLeaf[]
  sourceLabel: string
}

interface ImportCommitResult {
  inserted: number
  skipped: number
  updated: number
}

export type { BookmarkLeaf, BookmarkNode, DuplicateStrategy, ImportCommitResult, ImportPreview }
