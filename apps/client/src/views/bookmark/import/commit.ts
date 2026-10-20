import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import { pruneImportRoots } from '@/views/bookmark/import/prune'
import type {
  BookmarkNode,
  DuplicateStrategy,
  ImportCommitResult
} from '@/views/bookmark/import/types'

type CommitProgress = {
  percent: number
  label: string
}

/**
 * 将勾选子树写入 bookmark 表（跳过 / 覆盖）；不默认创建磁贴。
 */
async function commitBookmarkImport(options: {
  mirrorID: string
  roots: BookmarkNode[]
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
  const result = await invoke<Bookmark.ImportR>(CHANNELS.BOOKMARK.IMPORT, {
    params: {
      mirrorID: options.mirrorID,
      strategy: options.strategy,
      roots: pruned
    }
  })

  report?.({ percent: 100, label: '完成' })
  return {
    inserted: result.inserted,
    skipped: result.skipped,
    updated: result.updated
  }
}

export { commitBookmarkImport }
export type { CommitProgress }
