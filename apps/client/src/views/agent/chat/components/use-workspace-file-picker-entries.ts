import { useEffect, useState } from 'react'

import { WorkspaceFiles, type DirEntry } from '@/lib/workspace-files.ts'
import type { PickerEntry } from '@/views/agent/chat/components/workspace-file-picker-list'

/** 搜索防抖：每敲一个字就搜一次会把磁盘打满，列表也跟着闪 */
const SEARCH_DEBOUNCE_MS = 180

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

      function run() {
        const rowsPromise =
          needle.length > 0
            ? WorkspaceFiles.GET_WORKSPACE_FILES_SEARCH([root], needle, 40).then(function (result) {
                return result.hits.map(function (hit) {
                  return { name: hit.name, kind: hit.kind, relative: hit.relative }
                })
              })
            : WorkspaceFiles.GET_WORKSPACE_DIR(root, relative).then(function (rows: DirEntry[]) {
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
      }

      // 列目录是「打开就一次」，立即跑；搜索才需要等用户停手
      const timer = needle.length > 0 ? window.setTimeout(run, SEARCH_DEBOUNCE_MS) : undefined
      if (timer === undefined) run()

      return function () {
        cancelled = true
        if (timer !== undefined) window.clearTimeout(timer)
      }
    },
    [active, rootPath, relative, query, revision]
  )

  return { entries, isPending }
}

export { useWorkspaceFilePickerEntries }
