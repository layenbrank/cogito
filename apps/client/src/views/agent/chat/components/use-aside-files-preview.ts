/**
 * 右栏文件打开：文本走 Monaco 的完整读盘（对齐 Code 的 readCodeFile 限额），
 * 图片 / 音视频 / 二进制不读文本 —— 类型分流见 `aside-files-preview-kind.ts`。
 */
import { useEffect, useState } from 'react'

import { findAsidePreviewKind, isMediaKind } from '@/views/agent/chat/components/aside-files-preview-kind.ts'
import { readCodeFile } from '@/views/code/lib/fs.ts'
import { isLargeDocument } from '@/views/code/lib/file-limits.ts'
import { joinPath } from '@/views/code/lib/path.ts'

function useAsideFilesPreview(
  previewRelative: string | null,
  rootPath: string | null,
  /** 工作区版本号：分支切换后重新读盘 */
  revision = 0
) {
  const [contentState, updateContent] = useState<string | null>(null)
  const [isPending, updatePending] = useState(false)
  const [errorState, updateError] = useState<string | null>(null)
  const [isReadonly, updateReadonly] = useState(false)
  const [absolutePath, updateAbsolutePath] = useState<string | null>(null)

  const kind = findAsidePreviewKind(previewRelative)
  const content = previewRelative && rootPath ? contentState : null
  const error = previewRelative && rootPath ? errorState : null

  useEffect(
    function () {
      if (!previewRelative || !rootPath) {
        updateContent(null)
        updateError(null)
        updateReadonly(false)
        updateAbsolutePath(null)
        return
      }

      let cancelled = false
      const absolute = joinPath(rootPath, previewRelative)

      updateError(null)
      updateAbsolutePath(absolute)

      // 媒体与二进制没有「文本内容」可读：读盘只会换来一句「无法在编辑器中打开」
      if (kind !== 'text') {
        updateContent(null)
        updateReadonly(false)
        updatePending(false)
        return
      }

      updatePending(true)

      readCodeFile(absolute)
        .then(function (text) {
          if (cancelled) return
          updateContent(text)
          updateReadonly(
            isLargeDocument({
              getValueLength() {
                return text.length
              },
              getLineCount() {
                return text.split(/\r\n|\r|\n/).length
              }
            })
          )
        })
        .catch(function (cause) {
          console.warn('[agent/aside-files] 读取文件失败:', cause)
          if (!cancelled) {
            updateContent(null)
            updateReadonly(false)
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
    [previewRelative, rootPath, revision, kind]
  )

  return { content, error, isPending, isReadonly, absolutePath, kind, isMedia: isMediaKind(kind) }
}

export { useAsideFilesPreview }
