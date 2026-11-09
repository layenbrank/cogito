/**
 * 右栏预览按文件类型分流。
 *
 * 以前一律丢给 Monaco（`readCodeFile`），而它对二进制扩展名直接抛「无法在编辑器中打开」，
 * 图片 / 音视频 / pdf 点进去就只剩一行报错。这里先把类型判出来：
 * - `text`    → Monaco（可编辑）
 * - `image` / `audio` / `video` → asset 协议直接加载，不读文本
 * - `binary`  → 只给「用默认应用打开」，不尝试解码
 *
 * `svg` 刻意留在 text：它是文本、能编辑，锁成图片反而做不了事。
 */
import { hasBinaryExtension } from '@/views/code/lib/file-limits.ts'

type AsidePreviewKind = 'text' | 'image' | 'audio' | 'video' | 'binary'

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'tif',
  'tiff'
])

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'])

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'])

function findExtension(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function findAsidePreviewKind(relative: string | null): AsidePreviewKind {
  if (!relative) return 'text'
  const extension = findExtension(relative)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  // 其余二进制（pdf / 压缩包 / 可执行…）复用编辑器那份清单，别再各维护一套
  if (hasBinaryExtension(relative)) return 'binary'
  return 'text'
}

/** 这些类型不读文本内容：预览走 asset 协议 */
function isMediaKind(kind: AsidePreviewKind): boolean {
  return kind === 'image' || kind === 'audio' || kind === 'video'
}

export { findAsidePreviewKind, findExtension, isMediaKind }
export type { AsidePreviewKind }
