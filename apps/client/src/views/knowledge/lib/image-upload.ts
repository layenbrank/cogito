import { useKnowledgeStore } from '@/stores/knowledge'
import { writeBinaryBesideDoc } from '@/views/knowledge/lib/fs.ts'
import { t } from '@/views/knowledge/locale.ts'

/** 单张图片上限：20MB 以上基本是原图，插进笔记没有意义 */
const IMAGE_MAX_SIZE = 20 * 1024 * 1024

/**
 * 图片写入「当前笔记同目录的 assets/」，返回相对路径（`assets/xxx.png`）。
 *
 * 与粘贴 / 拖拽走同一套约定：markdown 里存相对路径，编辑器渲染时再解析成 asset 协议 URL
 * （见 `findImageSrc`），这样导出的 HTML 也能跟着笔记目录一起搬。
 */
async function uploadMarkdownImage(file: File): Promise<string> {
  const activePath = useKnowledgeStore.getState().activePath
  if (!activePath) throw new Error(t('IMAGE_UPLOAD_NEED_FILE'))

  const mimeExt = file.type.startsWith('image/') ? file.type.slice('image/'.length) : ''
  const ext = (mimeExt && !mimeExt.includes('+') ? mimeExt : null) || 'png'
  const bytes = new Uint8Array(await file.arrayBuffer())
  return writeBinaryBesideDoc(activePath, `img-${Date.now()}.${ext}`, bytes)
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  // 个别环境粘贴图 type 为空，用扩展名兜底
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)
}

/** 从 DataTransfer / clipboardData 抽出图片 File（兼容 files 与 items）。 */
function findClipboardImages(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const images: File[] = []
  const seen = new Set<string>()

  function pushFile(file: File | null) {
    if (!file || !isImageFile(file)) return
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    images.push(file)
  }

  if (data.files?.length) {
    for (const file of Array.from(data.files)) pushFile(file)
  }
  // Windows / 截图工具常把图放在 items 里，files 为空
  if (data.items?.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== 'file') continue
      if (item.type && !item.type.startsWith('image/')) continue
      pushFile(item.getAsFile())
    }
  }
  return images
}

/**
 * WebView 未暴露 clipboardData 图片时，走 Tauri 原生剪贴板读 RGBA → PNG File。
 * 剪贴板无图时返回 null（readImage 抛错）。
 */
async function findNativeClipboardImage(): Promise<File | null> {
  try {
    const { readImage } = await import('@tauri-apps/plugin-clipboard-manager')
    const image = await readImage()
    const rgba = await image.rgba()
    const size = await image.size()
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(rgba), size.width, size.height),
      0,
      0
    )
    const blob = await new Promise<Blob | null>(function (resolve) {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!blob) return null
    return new File([blob], `paste-${Date.now()}.png`, { type: 'image/png' })
  } catch (error) {
    console.debug('[knowledge] native clipboard image unavailable', error)
    return null
  }
}

export {
  IMAGE_MAX_SIZE,
  uploadMarkdownImage,
  findClipboardImages,
  findNativeClipboardImage
}
