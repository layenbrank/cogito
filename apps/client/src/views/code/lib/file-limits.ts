/**
 * 编辑器文件体量阈值与二进制判定。
 *
 * 大文件不能直接拒绝（日志、CSV、导出的 SQL 都属正常用法），所以分三档：
 * - 正常：全功能编辑
 * - 超过只读阈值：仍可查看，但关闭高亮/折叠等开销项并置只读
 * - 超过硬上限：拒绝打开，避免整份内容进渲染进程
 */

/** 超过此大小转「只读大文件」模式 */
const MAX_READONLY_BYTES = 2 * 1024 * 1024

/** 超过此大小直接拒绝打开 */
const MAX_OPEN_BYTES = 16 * 1024 * 1024

/** 单行极少但总行数巨大的压缩产物，同样按大文件处理 */
const MAX_READONLY_LINES = 40_000

/** 嗅探 NUL 的采样长度：文本文件头部不会出现 `\0` */
const SNIFF_BYTES = 8 * 1024

const BINARY_EXTENSIONS = new Set([
  // 图片 / 设计稿
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'tif',
  'tiff',
  'avif',
  'psd',
  'ai',
  // 字体
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  // 压缩包
  'zip',
  'rar',
  '7z',
  'gz',
  'tgz',
  'bz2',
  'xz',
  'tar',
  // 文档
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  // 音视频
  'mp3',
  'wav',
  'flac',
  'ogg',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  // 可执行与二进制产物
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'wasm',
  'msi',
  'dmg',
  'iso',
  'apk',
  'jar',
  'class',
  'pyc',
  // 数据库
  'db',
  'sqlite',
  'sqlite3'
])

function findExtension(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function hasBinaryExtension(path: string): boolean {
  return BINARY_EXTENSIONS.has(findExtension(path))
}

/** 头部采样里有 NUL 就当二进制（只认 `\0`，UTF-16 文件也常见但会误判，故只看前 8KB） */
function looksBinary(content: string): boolean {
  return content.slice(0, SNIFF_BYTES).includes('\u0000')
}

/** 结构性入参：不依赖 monaco 类型，方便单测 */
interface DocumentShape {
  getValueLength(): number
  getLineCount(): number
}

function isLargeDocument(document: DocumentShape): boolean {
  return (
    document.getValueLength() > MAX_READONLY_BYTES || document.getLineCount() > MAX_READONLY_LINES
  )
}

export {
  MAX_READONLY_BYTES,
  MAX_OPEN_BYTES,
  MAX_READONLY_LINES,
  hasBinaryExtension,
  looksBinary,
  isLargeDocument
}
export type { DocumentShape }
