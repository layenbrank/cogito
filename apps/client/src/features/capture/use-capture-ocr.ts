import { v4 as UUID } from 'uuid'
import { useState } from 'react'

import { recognizeText } from '@/features/capture/ocr'
import type { GraphicsProps } from '@/features/capture/components/graphics'
import { reportCaught } from '@/utils/exception-report'

function useCaptureOcr(input: {
  sourcePath: string | null
  sourceImage: HTMLImageElement | null
  selection: { x: number; y: number; w: number; h: number } | null
  color: string
  thickness: number
  fontSize: number
  filled: boolean
  opacity: number
  annotations: GraphicsProps[]
  onUpdateAnnotations: (next: GraphicsProps[]) => void
  commitHistory: (next: GraphicsProps[]) => void
}) {
  const [ocrText, onUpdateOcrText] = useState<string | null>(null)
  const [ocrBusy, onUpdateOcrBusy] = useState(false)

  async function runOcr() {
    if (!input.sourcePath || !input.sourceImage || ocrBusy) return
    onUpdateOcrBusy(true)
    onUpdateOcrText('')
    try {
      const scale = input.sourceImage.naturalWidth / Math.max(window.innerWidth, 1)
      const crop = input.selection
        ? {
            x: Math.round(input.selection.x * scale),
            y: Math.round(input.selection.y * scale),
            width: Math.round(input.selection.w * scale),
            height: Math.round(input.selection.h * scale)
          }
        : null
      const text = await recognizeText({ path: input.sourcePath, crop })
      onUpdateOcrText(text.trim() || '没有识别到文字')
    } catch (err) {
      reportCaught('capture.ocr', err)
      onUpdateOcrText(`取字失败：${String(err)}`)
    } finally {
      onUpdateOcrBusy(false)
    }
  }

  function insertOcrText() {
    const text = ocrText?.trim()
    if (!text || !input.selection) return
    const id = UUID()
    const next = input.annotations.concat([
      {
        id,
        type: 'text',
        color: input.color,
        thickness: input.thickness,
        fontSize: input.fontSize,
        filled: input.filled,
        opacity: input.opacity,
        text,
        points: [{ x: input.selection.x + 8, y: input.selection.y + 8 }]
      }
    ])
    input.onUpdateAnnotations(next)
    input.commitHistory(next)
    onUpdateOcrText(null)
  }

  return {
    ocrText,
    ocrBusy,
    onUpdateOcrText,
    runOcr,
    insertOcrText
  }
}

export { useCaptureOcr }
