/**
 * 解析 LLM 二阶段输出的 ---FILE: path--- / ---END FILE--- 块。
 * 移植自 llm_wiki ingest.ts（路径安全 + fence 感知 + 截断警告）。
 */

interface ParsedFileBlock {
  path: string
  content: string
}

interface ParseFileBlocksResult {
  blocks: ParsedFileBlock[]
  warnings: string[]
  truncatedPaths: string[]
}

const AGGREGATE_WIKI_PATHS = ['wiki/index.md', 'wiki/overview.md', 'wiki/log.md'] as const

const OPENER_LINE = /^---\s*FILE:\s*(.+?)\s*---\s*$/i
const CLOSER_LINE = /^---\s*END\s+FILE\s*---\s*$/i
const FENCE_LINE = /^\s{0,3}(```+|~~~+)/

function isWindowsSafePathSegment(segment: string): boolean {
  if (segment.length === 0) return false
  if (/[<>:"|?*]/.test(segment)) return false
  if (/[ .]$/.test(segment)) return false
  const stem = segment.split('.')[0]?.toUpperCase()
  if (!stem) return false
  if (
    stem === 'CON' ||
    stem === 'PRN' ||
    stem === 'AUX' ||
    stem === 'NUL' ||
    /^COM[1-9]$/.test(stem) ||
    /^LPT[1-9]$/.test(stem)
  ) {
    return false
  }
  return true
}

/** 拒绝逃逸 wiki/、绝对路径、..、Windows 非法段名 */
function isSafeIngestPath(path: string): boolean {
  if (typeof path !== 'string' || path.trim().length === 0) return false
  for (let i = 0; i < path.length; i += 1) {
    if (path.charCodeAt(i) <= 0x1f) return false
  }
  if (path.startsWith('/') || path.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(path)) return false
  const normalized = path.replace(/\\/g, '/')
  const segments = normalized.split('/')
  if (segments.some(function (seg) {
    return seg === '..'
  })) {
    return false
  }
  if (segments.some(function (seg) {
    return !isWindowsSafePathSegment(seg)
  })) {
    return false
  }
  if (!normalized.startsWith('wiki/')) return false
  return true
}

function isAggregateWikiPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return (AGGREGATE_WIKI_PATHS as readonly string[]).includes(normalized)
}

function parseFileBlocks(text: string): ParseFileBlocksResult {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const blocks: ParsedFileBlock[] = []
  const warnings: string[] = []
  const truncatedPaths: string[] = []

  let i = 0
  while (i < lines.length) {
    const openerMatch = OPENER_LINE.exec(lines[i] ?? '')
    if (!openerMatch) {
      i++
      continue
    }
    const path = (openerMatch[1] ?? '').trim()
    i++

    const contentLines: string[] = []
    let fenceMarker: string | null = null
    let fenceLen = 0
    let closed = false

    while (i < lines.length) {
      const line = lines[i] ?? ''
      const fenceMatch = FENCE_LINE.exec(line)
      if (fenceMatch) {
        const run = fenceMatch[1] ?? ''
        const char = run[0]
        const len = run.length
        if (fenceMarker === null) {
          fenceMarker = char
          fenceLen = len
        } else if (char === fenceMarker && len >= fenceLen) {
          fenceMarker = null
          fenceLen = 0
        }
        contentLines.push(line)
        i++
        continue
      }

      if (fenceMarker === null && CLOSER_LINE.test(line)) {
        closed = true
        i++
        break
      }

      contentLines.push(line)
      i++
    }

    if (!closed) {
      const pathLabel = path || '(unnamed)'
      const msg = `FILE block "${pathLabel}" was not closed before end of stream — likely truncation. Block dropped.`
      console.warn(`[ingest] ${msg}`)
      warnings.push(msg)
      if (isSafeIngestPath(path)) truncatedPaths.push(path)
      continue
    }

    if (!path) {
      const msg = 'FILE block with empty path skipped (LLM omitted the path after `---FILE:`).'
      console.warn(`[ingest] ${msg}`)
      warnings.push(msg)
      continue
    }

    if (!isSafeIngestPath(path)) {
      const msg = `FILE block with unsafe path "${path}" rejected (must be under wiki/, no .., no absolute paths).`
      console.warn(`[ingest] ${msg}`)
      warnings.push(msg)
      continue
    }

    if (isAggregateWikiPath(path)) {
      const msg = `FILE block "${path}" skipped (aggregate pages are app-maintained).`
      console.warn(`[ingest] ${msg}`)
      warnings.push(msg)
      continue
    }

    blocks.push({ path, content: contentLines.join('\n') })
  }

  return { blocks, warnings, truncatedPaths }
}

export {
  AGGREGATE_WIKI_PATHS,
  isAggregateWikiPath,
  isSafeIngestPath,
  parseFileBlocks
}
export type { ParsedFileBlock, ParseFileBlocksResult }
