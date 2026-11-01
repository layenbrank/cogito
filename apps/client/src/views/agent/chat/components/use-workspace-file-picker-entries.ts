import { useEffect, useState } from 'react'

import { WorkspaceFiles, type DirEntry } from '@/lib/workspace-files.ts'
import type { PickerEntry } from '@/views/agent/chat/components/workspace-file-picker-list'

function useWorkspaceFilePickerEntries(
  active: boolean,
  rootPath: string | null,
  relative: string,
  query: string,
  /** 工作区版本号：分支切换后重新列目录 */
  revision = 0
) {
  const [entriesState, updateEntries] = useState<PickerEntry[]>([])
  const [isPending, updatePending] = useState(false)
  const entries = active && rootPath ? entriesState : []

  useEffect(
    function () {
      if (!active || !rootPath) return
      let cancelled = false
      // 与 @ 触发器一致：去掉前导 `/` `./`，避免相对路径对不上
      const needle = query
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
      const root = rootPath

      updatePending(true)

      const rowsPromise =
        needle.length > 0
          ? WorkspaceFiles.search([root], needle, 40).then(function (result) {
              return result.hits.map(function (hit) {
                return {
                  name: hit.name,
                  kind: hit.kind === 'dir' ? ('dir' as const) : ('file' as const),
                  relative: hit.relative
                }
              })
            })
          : WorkspaceFiles.listDir(root, relative).then(function (rows: DirEntry[]) {
              return rows.map(function (row) {
                return { name: row.name, kind: row.kind, relative: row.relative }
              })
            })

      rowsPromise
        .then(function (rows) {
          if (!cancelled) updateEntries(rows)
        })
        .catch(function (error) {
          console.warn('[workspace-file-picker] 列目录/搜索失败:', error)
          if (!cancelled) updateEntries([])
        })
        .finally(function () {
          if (!cancelled) updatePending(false)
        })

      return function () {
        cancelled = true
      }
    },
    [active, rootPath, relative, query, revision]
  )

  return { entries, isPending }
}

export { useWorkspaceFilePickerEntries }
