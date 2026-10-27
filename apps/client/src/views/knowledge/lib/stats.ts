interface DocStats {
  chars: number
  words: number
  lines: number
}

/** 超过这个体量就不让实时预览渲染全文（会卡死主线程），改走源码模式 */
const LARGE_FILE_BYTES = 2 * 1024 * 1024

function isLargeMarkdown(content: string): boolean {
  return new TextEncoder().encode(content).byteLength >= LARGE_FILE_BYTES
}

/** 人读的文件尺寸（列表与清理提示共用同一口径） */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function findDocStats(source: string): DocStats {
  const text = source.replace(/\r\n/g, '\n')
  const trimmed = text.trim()
  const chars = text.length
  const lines = text === '' ? 0 : text.split('\n').length
  const words =
    trimmed === ''
      ? 0
      : trimmed.split(/\s+/).filter(function (part) {
          return part.length > 0
        }).length
  return { chars, words, lines }
}

export type { DocStats }
export { findDocStats, formatSize, isLargeMarkdown, LARGE_FILE_BYTES }
