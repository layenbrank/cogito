import { useEffect, useState } from 'react'

import { WorkspaceFiles } from '@/lib/workspace-files.ts'

const PREVIEW_CHAR_LIMIT = 120_000

function useAsideFilesPreview(
  previewRelative: string | null,
  rootPath: string | null,
  /** 工作区版本号：分支切换后重新读盘 */
  revision = 0
) {
  const [contentState, updateContent] = useState<string | null>(null)
  const [isPending, updatePending] = useState(false)
  const [errorState, updateError] = useState<string | null>(null)
  const [isTruncated, updateTruncated] = useState(false)

  const content = previewRelative && rootPath ? contentState : null
  const error = previewRelative && rootPath ? errorState : null

  useEffect(
    function () {
      if (!previewRelative || !rootPath) return

      let cancelled = false
      const root = rootPath
      const relative = previewRelative

      updatePending(true)
      updateError(null)

      WorkspaceFiles.readFile([root], relative)
        .then(function (result) {
          if (cancelled) return
          const text = result.content ?? ''
          if (text.length > PREVIEW_CHAR_LIMIT) {
            updateContent(text.slice(0, PREVIEW_CHAR_LIMIT))
            updateTruncated(true)
          } else {
            updateContent(text)
            updateTruncated(false)
          }
        })
        .catch(function (cause) {
          console.warn('[agent/aside-files] 读取文件失败:', cause)
          if (!cancelled) {
            updateContent(null)
            updateError(cause instanceof Error ? cause.message : '读取失败')
          }
        })
        .finally(function () {
          if (!cancelled) updatePending(false)
        })

      return function () {
        cancelled = true
      }
    },
    [previewRelative, rootPath, revision]
  )

  return { content, error, isPending, isTruncated, charLimit: PREVIEW_CHAR_LIMIT }
}

export { useAsideFilesPreview, PREVIEW_CHAR_LIMIT }
