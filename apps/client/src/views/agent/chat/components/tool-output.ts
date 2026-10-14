/**
 * 工具卡取数与折叠（纯函数）。
 * 终端正文必须先抽成真实文本，禁止整段 JSON.stringify（会把换行变成字面 `\n`）。
 */

const TERMINAL_PREVIEW_LINES = 48
const CODE_KEYS = ['code', 'script', 'source', 'javascript'] as const
const OUTPUT_KEYS = [
  'stdout',
  'stderr',
  'output',
  'result',
  'text',
  'content',
  'message',
  'data'
] as const

interface ShellCommand {
  command: string
  workdir: string | null
  background: boolean
}

interface CollapsedOutput {
  lines: string[]
  hidden: number
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function toShellCommand(args: unknown): ShellCommand | null {
  const record = toRecord(args)
  if (!record) return null

  const command = firstString(record, ['command', 'cmd', 'script'])
  if (command === null) return null

  const workdir = firstString(record, ['workdir', 'cwd', 'working_directory', 'path'])
  return {
    command,
    workdir,
    background: record.background === true
  }
}

function toCodeSource(args: unknown): string | null {
  const record = toRecord(args)
  if (!record) return null
  return firstString(record, CODE_KEYS)
}

/**
 * 部分链路会把已转义的串原样塞进来（字面 `\\n` / `\\r\\n` / `\\"`）。
 * 仅在「看起来像转义串」时解一层，避免误伤正常反斜杠路径。
 */
function unescapeLiteralEscapes(text: string): string {
  const hasEscapedBreaks = /\\r\\n|\\n|\\t/.test(text) && !text.includes('\n')
  if (!hasEscapedBreaks) return text
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/** 整段被二次 JSON 编码时解一层（`"...\\n..."` 或 `{"stdout":"..."}`） */
function unwrapEncodedBlob(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.length < 2) return null
  const startsObject = trimmed.startsWith('{') || trimmed.startsWith('[')
  const startsQuoted = trimmed.startsWith('"') && trimmed.endsWith('"')
  if (!startsObject && !startsQuoted) return null
  // 只有「像编码过」时才 parse，避免把普通以 `{` 开头的日志误当 JSON
  if (!startsQuoted && !/\\[nrt"\\]/.test(trimmed) && trimmed.includes('\n')) return null
  try {
    return JSON.parse(trimmed) as unknown
    // eslint-disable-next-line ith/catch-must-report -- 解析失败只说明「不是编码过的 JSON」，属预期分支，逐条上报会刷屏
  } catch {
    return null
  }
}

function findTextFromContentBlock(block: unknown): string | null {
  if (typeof block === 'string') return block
  const record = toRecord(block)
  if (!record) return null

  if (typeof record.text === 'string') return record.text

  const nested = toRecord(record.content)
  if (nested && typeof nested.text === 'string') return nested.text
  if (typeof record.content === 'string') return record.content

  return firstString(record, OUTPUT_KEYS)
}

/**
 * 到深度上限 / 无法再归类时的扁平化：对象走 JSON，原始值走 String。
 * 直接 `String(对象)` 只会得到 `[object Object]`，对终端可读性没意义。
 */
function toFlatText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'symbol' || typeof value === 'function') return value.toString()
  try {
    const json = JSON.stringify(value, null, 2)
    return json ?? Object.prototype.toString.call(value)
  } catch (error) {
    console.warn('[agent] 工具输出不可序列化，回退类型描述', error)
    return Array.isArray(value) ? '[Array]' : `[${value.constructor?.name ?? 'Object'}]`
  }
}

/** 把 goose / ACP 的杂形结果收成终端可读正文 */
function formatTerminalText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return ''
  if (depth > 3) return toFlatText(value)

  if (typeof value === 'string') {
    const unwrapped = unwrapEncodedBlob(value)
    if (unwrapped !== null && unwrapped !== value) {
      return formatTerminalText(unwrapped, depth + 1)
    }
    return unescapeLiteralEscapes(value.replace(/\r\n/g, '\n'))
  }

  if (Array.isArray(value)) {
    const chunks = value
      .map(function (item) {
        return findTextFromContentBlock(item)
      })
      .filter(function (item): item is string {
        return Boolean(item && item.length > 0)
      })
      .map(function (chunk) {
        return unescapeLiteralEscapes(chunk.replace(/\r\n/g, '\n'))
      })
    if (chunks.length > 0) {
      return chunks.join('\n')
    }
  }

  const record = toRecord(value)
  if (record) {
    const stdout = typeof record.stdout === 'string' ? record.stdout : ''
    const stderr = typeof record.stderr === 'string' ? record.stderr : ''
    if (stdout || stderr) {
      // 各流单独解转义再拼接，避免 join 出的真换行挡住字面 `\n` 的识别
      const parts = [stdout, stderr]
        .filter(Boolean)
        .map(function (part) {
          return unescapeLiteralEscapes(part.replace(/\r\n/g, '\n'))
        })
      return parts.join('\n')
    }

    const picked = firstString(record, OUTPUT_KEYS)
    if (picked) return formatTerminalText(picked, depth + 1)

    if (Array.isArray(record.content)) {
      return formatTerminalText(record.content, depth + 1)
    }
  }

  return toFlatText(value)
}

function collapseOutput(
  raw: string | null | undefined,
  maxLines = TERMINAL_PREVIEW_LINES
): CollapsedOutput {
  if (raw === null || raw === undefined) return { lines: [], hidden: 0 }

  const normalized = unescapeLiteralEscapes(raw.replace(/\r\n/g, '\n')).replace(/\n+$/, '')
  const lines = normalized.split('\n')
  if (lines.length === 1 && lines[0] === '') return { lines: [], hidden: 0 }
  if (lines.length <= maxLines) return { lines, hidden: 0 }

  return { lines: lines.slice(0, maxLines), hidden: lines.length - maxLines }
}

export {
  CODE_KEYS,
  collapseOutput,
  formatTerminalText,
  TERMINAL_PREVIEW_LINES,
  toCodeSource,
  toShellCommand
}
export type { CollapsedOutput, ShellCommand }
