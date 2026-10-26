import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

/** 裁剪区域（原图像素坐标） */
interface OcrCrop {
  x: number
  y: number
  width: number
  height: number
}

interface OcrResult {
  text: string
}

interface OcrInput {
  /** 截图落盘的绝对路径 */
  path: string
  /** 不传则识别整张图 */
  crop?: OcrCrop | null
  /** 识别语言（可选，默认跟随系统） */
  language?: string
}

/** 取字：选区裁剪 → 识别 → 文本 */
async function recognizeText(input: OcrInput): Promise<string> {
  const result = await invoke<OcrResult>(CHANNELS.CAPTURE.OCR, {
    params: {
      path: input.path,
      crop: input.crop ?? null,
      language: input.language ?? null
    }
  })
  return result.text
}

export { recognizeText }
export type { OcrCrop, OcrResult }
