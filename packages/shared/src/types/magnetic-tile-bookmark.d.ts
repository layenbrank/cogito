/**
 * 书签库（独立表 `bookmark`）：文件夹树持久化。
 * 可再挂到 `navigation` / `collection` 磁贴，非导入时默认全量建磁贴。
 */
declare namespace Bookmark {
  interface Entry {
    id: string
    mirrorID: string
    parentID: string | null
    title: string
    /** null = 文件夹 */
    url: string | null
    index: number
    createdAt: number
    updatedAt: number
  }

  interface ImportNode {
    title: string
    url?: string
    children?: ImportNode[]
  }

  interface ImportP {
    mirrorID: string
    strategy: 'skip' | 'overwrite'
    roots: ImportNode[]
  }

  interface ImportR {
    inserted: number
    skipped: number
    updated: number
  }

  interface Read {
    id?: string
    mirrorID?: string
    /** null 表示查根层；undefined 表示不按 parent 过滤 */
    parentID?: string | null
    url?: string
  }
}

/** @deprecated 使用 Bookmark.Entry；独立 Bookmark 双轨已并入 bookmark 表 */
declare namespace MagneticTile.Bookmark {
  type Entry = Bookmark.Entry
  type Directory = Bookmark.Entry
}
