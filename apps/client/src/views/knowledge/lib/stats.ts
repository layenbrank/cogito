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
export { findDocStats, isLargeMarkdown, LARGE_FILE_BYTES }
