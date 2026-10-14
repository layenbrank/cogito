interface DocStats {
  chars: number
  words: number
  lines: number
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
export { findDocStats }
