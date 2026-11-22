import { database } from '@/database/database.ts'
import { normalizeUrl } from '@/views/bookmark/import/flatten'
import { pruneImportRoots, type ImportNode } from '@/views/bookmark/import/prune'
import type { DuplicateStrategy, ImportCommitResult } from '@/views/bookmark/import/types'

type CommitProgress = {
  percent: number
  label: string
}

type Counters = {
  inserted: number
  skipped: number
  updated: number
}

function folderKey(parentID: string | null, title: string): string {
  return `${parentID ?? ''}\0${title}`
}

function isUnsafeUrl(url: string): boolean {
  return /^(javascript|data|vbscript):/i.test(url)
}

/**
 * 将勾选子树写入 bookmark 表（跳过 / 覆盖）；不默认创建磁贴。
 * 重复规则与客户端 bookmark service 一致。
 */
async function commitBookmarkImport(options: {
  mirrorID: string
  roots: Parameters<typeof pruneImportRoots>[0]
  selectedFolders: string[]
  strategy: DuplicateStrategy
  onProgress?: (progress: CommitProgress) => void
}): Promise<ImportCommitResult> {
  const report = options.onProgress
  report?.({ percent: 10, label: '整理文件夹树…' })

  const pruned = pruneImportRoots(options.roots, options.selectedFolders)
  if (!pruned.length) {
    throw new Error('请至少勾选一个文件夹')
  }

  report?.({ percent: 40, label: '写入书签库…' })
  const counters: Counters = { inserted: 0, skipped: 0, updated: 0 }

  await database.transaction('rw', database.bookmark, async function () {
    const rows = await database.bookmark.where('mirrorID').equals(options.mirrorID).toArray()
    const byUrl = new Map<string, Bookmark.Entry>()
    const folders = new Map<string, Bookmark.Entry>()
    for (const row of rows) {
      if (row.url) byUrl.set(normalizeUrl(row.url), row)
      else folders.set(folderKey(row.parentID, row.title), row)
    }

    async function importNode(
      parentID: string | null,
      node: ImportNode,
      index: number
    ): Promise<void> {
      const title = node.title.trim() || '未命名'
      const rawUrl = node.url?.trim()
      if (rawUrl) {
        if (isUnsafeUrl(rawUrl)) {
          counters.skipped += 1
          return
        }
        const url = normalizeUrl(rawUrl)
        const existing = byUrl.get(url)
        if (existing) {
          if (options.strategy === 'skip') {
            counters.skipped += 1
            return
          }
          const now = Date.now()
          const next: Bookmark.Entry = {
            ...existing,
            title,
            parentID,
            index,
            updatedAt: now
          }
          await database.bookmark.put(next)
          byUrl.set(url, next)
          counters.updated += 1
          return
        }
        const created = await writeOne(parentID, title, url, index)
        byUrl.set(url, created)
        counters.inserted += 1
        return
      }

      const key = folderKey(parentID, title)
      let folder = folders.get(key)
      if (!folder) {
        folder = await writeOne(parentID, title, null, index)
        folders.set(key, folder)
        counters.inserted += 1
      }
      const children = node.children ?? []
      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const child = children[childIndex]
        if (!child) continue
        await importNode(folder.id, child, childIndex)
      }
    }

    async function writeOne(
      parentID: string | null,
      title: string,
      url: string | null,
      index: number
    ): Promise<Bookmark.Entry> {
      const now = Date.now()
      const row: Bookmark.Entry = {
        id: crypto.randomUUID(),
        mirrorID: options.mirrorID,
        parentID,
        title,
        url,
        index,
        createdAt: now,
        updatedAt: now
      }
      await database.bookmark.add(row)
      return row
    }

    for (let index = 0; index < pruned.length; index += 1) {
      const root = pruned[index]
      if (!root) continue
      await importNode(null, root, index)
    }
  })

  report?.({ percent: 100, label: '完成' })
  return counters
}

export { commitBookmarkImport }
export type { CommitProgress }
