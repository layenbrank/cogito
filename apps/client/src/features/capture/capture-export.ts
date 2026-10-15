import type { RefObject } from 'react'

import { copyImage, pinTexture, saveToUserPath } from '@/features/capture/clipboard'
import type { AnnotationHandle } from '@/features/capture/components/annotation'
import { toRecordCapture } from '@/features/capture/history'

interface CaptureExportInput {
  annotationRef: RefObject<AnnotationHandle | null>
  sessionID: string
  onExit?: () => void
  onTexture?: (input: { src: string; w: number; h: number }) => void
  /** 会话首次成功写入历史后回调（用于触发清理节流） */
  onHistoryWritten?: () => void
}

async function withStagePng(
  annotationRef: RefObject<AnnotationHandle | null>,
  action: (dataUrl: string) => Promise<void>
) {
  const dataUrl = annotationRef.current?.renderPng()
  if (!dataUrl) return
  try {
    await action(dataUrl)
  } catch (err) {
    console.error('[capture] 处理截图结果失败', err)
  }
}

function createCaptureExport(input: CaptureExportInput) {
  let hasWritten = false

  async function recordHistory(dataUrl: string) {
    const id = await toRecordCapture({ png: dataUrl, sessionID: input.sessionID })
    if (id && !hasWritten) {
      hasWritten = true
      input.onHistoryWritten?.()
    }
  }

  function handleCopy() {
    void withStagePng(input.annotationRef, async function (dataUrl) {
      await recordHistory(dataUrl)
      await copyImage(dataUrl)
      input.onExit?.()
    })
  }

  function handlePin() {
    void withStagePng(input.annotationRef, async function (dataUrl) {
      await recordHistory(dataUrl)
      const result = await pinTexture(dataUrl)
      input.onTexture?.({ src: result.filePath, w: result.w, h: result.h })
      input.onExit?.()
    })
  }

  function handleSave() {
    void withStagePng(input.annotationRef, async function (dataUrl) {
      const path = await saveToUserPath(dataUrl)
      // 用户取消另存时不产生历史记录
      if (!path) return
      await recordHistory(dataUrl)
      input.onExit?.()
    })
  }

  function handleClose() {
    input.onExit?.()
  }

  return { handleCopy, handlePin, handleSave, handleClose }
}

export { createCaptureExport }
