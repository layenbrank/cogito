import { useMarkdownStore } from '@/stores/markdown'
import { writeBinaryBesideDoc } from '@/views/markdown/lib/fs.ts'
import { t } from '@/views/markdown/locale.ts'

/** 单张图片上限：20MB 以上基本是原图，插进笔记没有意义 */
const IMAGE_MAX_SIZE = 20 * 1024 * 1024

/**
 * 图片写入「当前笔记同目录的 assets/」，返回相对路径（`assets/xxx.png`）。
 *
 * 与粘贴 / 拖拽走同一套约定：markdown 里存相对路径，编辑器渲染时再解析成 asset 协议 URL
 * （见 `findImageSrc`），这样导出的 HTML 也能跟着笔记目录一起搬。
 */
async function uploadMarkdownImage(file: File): Promise<string> {
  const activePath = useMarkdownStore.getState().activePath
  if (!activePath) throw new Error(t('IMAGE_UPLOAD_NEED_FILE'))

  const ext = file.type.split('/')[1] || 'png'
  const bytes = new Uint8Array(await file.arrayBuffer())
  return writeBinaryBesideDoc(activePath, `img-${Date.now()}.${ext}`, bytes)
}

export { IMAGE_MAX_SIZE, uploadMarkdownImage }
