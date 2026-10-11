import type { RefObject } from 'react'

import type { AnnotationHandle } from '@/features/capture/components/annotation'
import { copyImage, pinTexture, saveToUserPath } from '@/features/capture/clipboard'

interface CaptureExportInput {
  annotationRef: RefObject<AnnotationHandle | null>
  onExit?: () => void
  onTexture?: (input: { src: string; w: number; h: number }) => void
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
  function handleCopy() {
    void withStagePng(input.annotationRef, async function (dataUrl) {
      await copyImage(dataUrl)
      input.onExit?.()
    })
  }

  function handlePin() {
    void withStagePng(input.annotationRef, async function (dataUrl) {
      const result = await pinTexture(dataUrl)
      input.onTexture?.({ src: result.filePath, w: result.w, h: result.h })
      input.onExit?.()
    })
  }

  function handleSave() {
    void withStagePng(input.annotationRef, async function (dataUrl) {
      const path = await saveToUserPath(dataUrl)
      if (path) input.onExit?.()
    })
  }

  function handleClose() {
    input.onExit?.()
  }

  return { handleCopy, handlePin, handleSave, handleClose }
}

export { createCaptureExport }
