/**
 * 工具结果解析：一次抽正文，再决定用哪种**结构**渲染。
 *
 * 本轮已下线「按输出文本猜卡型」：commit / test / stack / package / env / schema /
 * snippet 七种启发式（`parseCommitOutput` / `parseVitestOutput` / `parseStackOutput` /
 * `parseEnvOutput` / `parsePackageOutput` / `parseSchemaOutput` / `parseSnippetOutput`）
 * 连同对应卡片一起删除 —— 正则猜错时比通用文本更难读，且一次回答里会堆出七八张重卡片。
 * 现在只保留两类**结构确定的**解析：
 * - 写工具的行级 diff（参数里就有 before/after，不是猜的）；
 * - 目录列举的文件树（工具名 + 路径清单，仍是结构而非文案）。
 * 其余一律「通用行 + 展开原文」。后续方向是按 tool 名注册 assistant-ui 渲染器。
 *
 * 写工具行级 diff：同步 `buildLineDiff` 留给测试 / 首屏；Tauri 下 UI 走
 * `fetchWriteCodeDiff` → `agentTool:lineDiff`。
 */
import { toTimelineWhen } from '@cogito/design/assistant/timeline-state'
import type { TimelineEvent } from '@cogito/design/assistant/timeline-state'
import type { ToolCallState } from '@cogito/design/assistant/tool-call-state'
import { toDomain } from '@cogito/design/assistant/web-search-state'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { invoke } from '@tauri-apps/api/core'

import {
  isCalendarTool,
  isCodeTool,
  isReadTool,
  isRetrievalTool,
  isSearchTool,
  isShellTool,
  isWebTool,
  isWriteTool,
  type ToolCardVariant
} from '@/features/agent/tool-labels'
import { CHANNELS } from '@/shared/ipc/channels'
import { formatTerminalText, normalizeToolOutput } from './tool-output'

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

const HTTP_URL = /https?:\/\/[^\s)\]"']+/g

type ToolFamily = 'shell' | 'code' | 'files' | 'web' | 'generic'
type SpecialKind = ParsedToolSpecial['kind']

interface ParsedFileTreeNode {
  path: string
  isDirectory: boolean
}

/** 只剩目录列举一种专项：其余七种「猜出来的卡」已下线（见文件头注） */
type ParsedToolSpecial = { kind: 'tree'; data: readonly ParsedFileTreeNode[] }

interface WebSource {
  title: string
  href: string
  /** 展示用域名（元素行右侧的等宽标签） */
  domain: string
}

interface SpecialParseContext {
  text: string
  toolName: string
  args: unknown
  result: unknown
}

interface ParsedToolCard {
  text: string
  special: ParsedToolSpecial | null
  variant: ToolCardVariant
}

interface WriteDiffStat {
  added: number
  removed: number
}

type WriteDiffKind = 'context' | 'added' | 'removed'

interface WriteDiffLine {
  kind: WriteDiffKind
  text: string
}

interface WriteCodeDiff {
  filename: string
  additions: number
  deletions: number
  lines: readonly WriteDiffLine[]
}

const WRITE_OLD_KEYS = [
  'old_string',
  'oldString',
  'oldText',
  'before',
  'old_content'
] as const

const WRITE_NEW_KEYS = [
  'new_string',
  'newString',
  'newText',
  'after',
  'contents',
  'content',
  'new_content'
] as const

/** 超过此乘积不做 LCS，退回整段删+增，避免大文件卡主线程 */
const LINE_DIFF_LCS_CAP = 200_000

/** 各工具族允许的专项渲染；只剩目录列举（结构确定，不靠正文猜） */
const SPECIAL_KINDS: Readonly<Record<ToolFamily, readonly SpecialKind[]>> = {
  shell: [],
  code: [],
  files: ['tree'],
  web: [],
  generic: ['tree']
}

const EXT_LANGUAGE = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.rs': 'rust',
  '.py': 'python'
} as const

type CodeHighlightLanguage = (typeof EXT_LANGUAGE)[keyof typeof EXT_LANGUAGE] | 'markdown'

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** 不 trim 的取值：写回文件时要保留首行缩进与结尾换行 */
function firstRawString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function parseToolOutputText(result: unknown): string {
  return formatTerminalText(result)
}

function findToolFamily(toolName: string): ToolFamily {
  if (isShellTool(toolName)) return 'shell'
  if (isCodeTool(toolName)) return 'code'
  if (isWebTool(toolName)) return 'web'
  if (isReadTool(toolName) || isWriteTool(toolName) || isSearchTool(toolName)) return 'files'
  return 'generic'
}

function findBaseVariant(toolName: string): ToolCardVariant {
  if (isShellTool(toolName)) return 'command'
  if (isCodeTool(toolName)) return 'code'
  if (isWebTool(toolName)) return 'web'
  if (isRetrievalTool(toolName)) return 'retrieval'
  // 日历要排在读写之前：`app_calendar_read` 名字里带 `read`
  if (isCalendarTool(toolName)) return 'timeline'
  if (isWriteTool(toolName)) return 'write'
  if (isSearchTool(toolName)) return 'search'
  if (isReadTool(toolName)) return 'read'
  return 'generic'
}

function parseTreeOutput(
  text: string,
  toolName: string,
  result: unknown
): readonly ParsedFileTreeNode[] | null {
  const lower = toolName.toLowerCase()
  if (!lower.includes('list') && !lower.includes('dir') && !lower.includes('glob')) {
    return null
  }

  const record = toRecord(result)
  const pathsField = record?.paths ?? record?.files ?? record?.entries
  if (Array.isArray(pathsField)) {
    const nodes: ParsedFileTreeNode[] = []
    for (let i = 0; i < pathsField.length; i += 1) {
      const item: unknown = pathsField[i]
      if (typeof item === 'string') {
        nodes.push({ path: item, isDirectory: item.endsWith('/') })
        continue
      }
      const row = toRecord(item)
      const path = row && firstString(row, ['path', 'name', 'relative'])
      if (!path) continue
      nodes.push({
        path,
        isDirectory: row?.isDirectory === true || path.endsWith('/')
      })
    }
    return nodes.length > 0 ? nodes : null
  }

  const lines = text.split('\n')
  const paths: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line) paths.push(line)
  }
  if (paths.length < 2) return null
  for (let i = 0; i < paths.length; i += 1) {
    const line = paths[i]
    if (line.includes(' ') && !line.startsWith('./') && !line.startsWith('/')) return null
  }
  return paths.map(function (path) {
    return { path, isDirectory: path.endsWith('/') }
  })
}

/**
 * 唯一的专项解析：目录列举 → 文件树。
 * 结构确定（工具名 + 路径清单），不靠正文正则猜；七种猜出来的卡已下线（见文件头注）。
 */
function parseSpecialKind(context: SpecialParseContext): ParsedToolSpecial | null {
  const data = parseTreeOutput(context.text, context.toolName, context.result)
  return data ? { kind: 'tree', data } : null
}

/** 一次抽正文 + 按族跑 P1；避免 tool-card 重复 formatTerminalText / 跑无关解析器 */
function parseToolCard(toolName: string, args: unknown, result: unknown): ParsedToolCard {
  const text = parseToolOutputText(result)
  const base = findBaseVariant(toolName)
  if (!text && result === undefined) {
    return { text: '', special: null, variant: base }
  }

  const family = findToolFamily(toolName)
  const context: SpecialParseContext = { text, toolName, args, result }
  if (SPECIAL_KINDS[family].length > 0) {
    const special = parseSpecialKind(context)
    if (special) return { text, special, variant: special.kind }
  }
  return { text, special: null, variant: base }
}

function findCodeLanguage(toolName: string, args: unknown): CodeHighlightLanguage {
  const record = toRecord(args)
  const lang = record && firstString(record, ['language', 'lang'])
  if (lang === 'typescript' || lang === 'ts') return 'typescript'
  if (lang === 'javascript' || lang === 'js') return 'javascript'
  if (lang === 'json') return 'json'
  if (lang === 'markdown' || lang === 'md') return 'markdown'
  if (lang === 'rust' || lang === 'rs') return 'rust'
  if (lang === 'python' || lang === 'py') return 'python'

  const lower = toolName.toLowerCase()
  if (lower.includes('grep') || lower.includes('glob')) return 'markdown'

  if (isReadTool(toolName) || isWriteTool(toolName)) {
    const path =
      (record && firstString(record, ['filePath', 'path', 'file_path', 'target'])) ?? ''
    const ext = Object.keys(EXT_LANGUAGE).find(function (suffix) {
      return path.endsWith(suffix)
    }) as keyof typeof EXT_LANGUAGE | undefined
    if (ext) return EXT_LANGUAGE[ext]
  }
  return 'markdown'
}

function findWritePath(args: unknown): string | null {
  const record = toRecord(args)
  if (!record) return null
  return firstString(record, ['filePath', 'path', 'file_path', 'target'])
}

function splitDiffLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
}

function findWriteTextPair(args: unknown): { oldText: string | null; newText: string | null } {
  const record = toRecord(args)
  if (!record) return { oldText: null, newText: null }
  return {
    oldText: firstString(record, [...WRITE_OLD_KEYS]),
    newText: firstString(record, [...WRITE_NEW_KEYS])
  }
}

/**
 * 未 trim 的 before / after 原文（审阅按块保留用）。
 *
 * `findWriteTextPair` 会把整段文本 trim 掉，渲染 diff 无所谓；但「按块保留」要把结果写回文件，
 * 首行缩进与结尾换行必须原样带回去，所以这条路单独取原文。
 */
function parseWriteTexts(args: unknown): { before: string | null; after: string | null } {
  const record = toRecord(args)
  if (!record) return { before: null, after: null }
  return {
    before: firstRawString(record, [...WRITE_OLD_KEYS]),
    after: firstRawString(record, [...WRITE_NEW_KEYS])
  }
}

/**
 * 行级 LCS → unified DiffLine；过大时退回整段删+增。
 * 生产路径优先走 Rust `agentTool:lineDiff`（见 `tool-line-diff.ts`）；
 * 本函数保留给单测与非 Tauri 回落。
 */
function buildLineDiff(
  oldText: string,
  newText: string
): { lines: WriteDiffLine[]; additions: number; deletions: number } {
  if (oldText === newText) {
    const lines = splitDiffLines(oldText).map(function (text) {
      return { kind: 'context' as const, text }
    })
    return { lines, additions: 0, deletions: 0 }
  }

  const oldLines = splitDiffLines(oldText)
  const newLines = splitDiffLines(newText)

  if (oldLines.length === 0) {
    return {
      lines: newLines.map(function (text) {
        return { kind: 'added' as const, text }
      }),
      additions: newLines.length,
      deletions: 0
    }
  }
  if (newLines.length === 0) {
    return {
      lines: oldLines.map(function (text) {
        return { kind: 'removed' as const, text }
      }),
      additions: 0,
      deletions: oldLines.length
    }
  }

  if (oldLines.length * newLines.length > LINE_DIFF_LCS_CAP) {
    return {
      lines: [
        ...oldLines.map(function (text) {
          return { kind: 'removed' as const, text }
        }),
        ...newLines.map(function (text) {
          return { kind: 'added' as const, text }
        })
      ],
      additions: newLines.length,
      deletions: oldLines.length
    }
  }

  const rows = oldLines.length
  const cols = newLines.length
  const dp: Uint32Array[] = Array.from({ length: rows + 1 }, function () {
    return new Uint32Array(cols + 1)
  })
  for (let i = 1; i <= rows; i += 1) {
    const row = dp[i]
    const prev = dp[i - 1]
    const oldLine = oldLines[i - 1]
    for (let j = 1; j <= cols; j += 1) {
      row[j] =
        oldLine === newLines[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], row[j - 1])
    }
  }

  const reversed: WriteDiffLine[] = []
  let i = rows
  let j = cols
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ kind: 'context', text: oldLines[i - 1] })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ kind: 'added', text: newLines[j - 1] })
      j -= 1
    } else {
      reversed.push({ kind: 'removed', text: oldLines[i - 1] })
      i -= 1
    }
  }
  reversed.reverse()

  let additions = 0
  let deletions = 0
  for (let index = 0; index < reversed.length; index += 1) {
    const kind = reversed[index].kind
    if (kind === 'added') additions += 1
    else if (kind === 'removed') deletions += 1
  }
  return { lines: reversed, additions, deletions }
}

/** 写工具 → CodeDiff 数据；缺 before/after 时返回 null（同步，测试 / 首屏用） */
function parseWriteCodeDiff(args: unknown): WriteCodeDiff | null {
  const path = findWritePath(args)
  const { oldText, newText } = findWriteTextPair(args)
  if (!newText && !oldText) return null

  const filename = path ? findBaseName(path) : 'file'
  if (oldText && newText) {
    const diff = buildLineDiff(oldText, newText)
    return { filename, ...diff }
  }
  if (newText) {
    const lines = splitDiffLines(newText).map(function (text) {
      return { kind: 'added' as const, text }
    })
    return { filename, additions: lines.length, deletions: 0, lines }
  }
  const lines = splitDiffLines(oldText!).map(function (text) {
    return { kind: 'removed' as const, text }
  })
  return { filename, additions: 0, deletions: lines.length, lines }
}

/** Tauri 下把行级 diff 卸到 Rust；失败回退同步 LCS */
async function fetchWriteCodeDiff(args: unknown): Promise<WriteCodeDiff | null> {
  const path = findWritePath(args)
  const { oldText, newText } = findWriteTextPair(args)
  if (!newText && !oldText) return null

  const filename = path ? findBaseName(path) : 'file'
  if (oldText && newText && isTauriRuntime()) {
    try {
      const diff = await invoke<{
        lines: WriteDiffLine[]
        additions: number
        deletions: number
      }>(CHANNELS.AGENT_TOOL.LINE_DIFF, {
        params: { oldText, newText }
      })
      return { filename, ...diff }
    } catch (error) {
      console.warn('[agent] agentTool:lineDiff 失败，回退 TS LCS:', error)
    }
  }
  return parseWriteCodeDiff(args)
}

/** 异步版 parseToolCard：正文优先 Rust normalize */
async function parseToolCardAsync(
  toolName: string,
  args: unknown,
  result: unknown
): Promise<ParsedToolCard> {
  const text = await normalizeToolOutput(result)
  const base = findBaseVariant(toolName)
  if (!text && result === undefined) {
    return { text: '', special: null, variant: base }
  }

  const family = findToolFamily(toolName)
  const context: SpecialParseContext = { text, toolName, args, result }
  if (SPECIAL_KINDS[family].length > 0) {
    const special = parseSpecialKind(context)
    if (special) return { text, special, variant: special.kind }
  }
  return { text, special: null, variant: base }
}

/** 折叠标题旁 +/-；有可 diff 文本时跟 CodeDiff 计数一致 */
function parseWriteDiffStat(args: unknown): WriteDiffStat | null {
  const codeDiff = parseWriteCodeDiff(args)
  if (codeDiff) {
    return { added: codeDiff.additions, removed: codeDiff.deletions }
  }
  return null
}

function findBaseName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash < 0 ? path : path.slice(slash + 1)
}

/** 查询词字段：不同 provider 的叫法不一样，按常见顺序取第一个非空 */
const WEB_QUERY_KEYS = [
  'query',
  'q',
  'search',
  'searchQuery',
  'search_query',
  'keyword',
  'keywords'
] as const

/** 结构化来源里认的字段：链接与标题各一组 */
const WEB_HREF_KEYS = ['url', 'href', 'link', 'uri', 'source_url'] as const
const WEB_TITLE_KEYS = ['title', 'name', 'heading', 'label', 'page_title'] as const

/** 结果常挂在某一层数组下：这些键继续往下钻（`{results: []}` / `{data: {sources: []}}`） */
const WEB_SOURCE_KEYS = [
  'results',
  'sources',
  'items',
  'links',
  'pages',
  'entries',
  'references',
  'data'
] as const

/** markdown 链接：标题比 URL 好读，能拆就拆 */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g

/** 查询词（`args.query` 一类的字段）：联网检索与库内检索共用同一套键名 */
function extractQuery(args: unknown): string | null {
  const record = toRecord(args)
  if (!record) return null
  return firstString(record, [...WEB_QUERY_KEYS])
}

/** 联网检索的查询词（历史名字，与 `extractQuery` 同一实现） */
const extractWebQuery = extractQuery

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function toWebSource(href: string, title?: string | null): WebSource {
  const url = href.trim()
  return { title: (title ?? '').trim() || url, href: url, domain: toDomain(url) }
}

/**
 * 结构化结果 → 来源行：数组逐条取，对象往下钻一层。
 *
 * 联网检索的返回形状各家不同（`{results: [{title, url}]}` / `{data: {sources: [...]}}` /
 * 直接一个数组），所以按「认字段 + 钻一层」处理，不给 provider 写分支。
 */
function collectWebSources(value: unknown, out: WebSource[], depth: number): void {
  if (depth > 3 || value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) collectWebSources(value[i], out, depth + 1)
    return
  }
  const record = toRecord(value)
  if (!record) return
  const href = firstString(record, [...WEB_HREF_KEYS])
  if (href && isHttpUrl(href)) {
    out.push(toWebSource(href, firstString(record, [...WEB_TITLE_KEYS])))
  }
  for (let i = 0; i < WEB_SOURCE_KEYS.length; i += 1) {
    const nested = record[WEB_SOURCE_KEYS[i]]
    if (nested && typeof nested === 'object') collectWebSources(nested, out, depth + 1)
  }
}

/** 结果是「被序列化过的 JSON 字符串」时先解一层（ACP 的 content 块常这样） */
function parseEmbeddedJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
    // eslint-disable-next-line ith/catch-must-report -- 解析失败只说明「不是编码过的 JSON」，属预期分支，逐条上报会刷屏
  } catch {
    return null
  }
}

/**
 * 联网检索的来源清单：结构化优先，文本兜底。
 *
 * 结构化（`result` 或结果里编码的 JSON）能拿到**标题** —— 这是 `web-search` 元素
 * 每行最要紧的那半截；只有文本时才退回「markdown 链接 → 裸 URL」，那时标题只能退化成
 * URL 本身。参数里的 `url`（`web_fetch` 这类单页抓取）排最前：它就是这次读的
 * 那一个来源。
 */
function parseWebSources(
  toolName: string,
  args: unknown,
  result: unknown,
  outputText?: string
): readonly WebSource[] {
  if (!isWebTool(toolName)) return []

  const found: WebSource[] = []
  const record = toRecord(result)
  if (record) collectWebSources(record, found, 0)
  if (typeof result === 'string') {
    const embedded = parseEmbeddedJson(result)
    if (embedded) collectWebSources(embedded, found, 0)
  }

  const argRecord = toRecord(args)
  const argUrl = argRecord && firstString(argRecord, ['url', 'href', 'uri'])
  if (argUrl && isHttpUrl(argUrl)) found.unshift(toWebSource(argUrl, extractWebQuery(args)))

  if (found.length === 0) {
    const text = outputText ?? parseToolOutputText(result)
    MARKDOWN_LINK.lastIndex = 0
    let match = MARKDOWN_LINK.exec(text)
    while (match !== null) {
      found.push(toWebSource(match[2], match[1]))
      match = MARKDOWN_LINK.exec(text)
    }
    const urls = text.match(HTTP_URL) ?? []
    for (let i = 0; i < urls.length; i += 1) found.push(toWebSource(urls[i]))
  }

  const rows: WebSource[] = []
  const seen = new Set<string>()
  for (let i = 0; i < found.length; i += 1) {
    const source = found[i]
    if (seen.has(source.href)) continue
    seen.add(source.href)
    rows.push(source)
  }
  return rows
}

/** 日历工具返回的日程列表键名（`app_calendar_read` 可能直接给数组，也可能包一层） */
const CALENDAR_LIST_KEYS = ['events', 'items', 'schedules', 'calendar', 'data', 'results'] as const

interface CalendarEvent {
  id: string
  title: string
  startAt: number
  endAt: number
  entireDay: boolean
  notes: string
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }
  return null
}

/** 列表可能直接挂在外层，也可能包一层（`{data: {items: [...]}}`）：往里钻一层 */
function findCalendarList(record: Record<string, unknown>): readonly unknown[] | null {
  for (const key of CALENDAR_LIST_KEYS) {
    const value = record[key]
    if (Array.isArray(value)) return value
    const nested = toRecord(value)
    if (!nested) continue
    for (const inner of CALENDAR_LIST_KEYS) {
      const innerValue = nested[inner]
      if (Array.isArray(innerValue)) return innerValue
    }
  }
  return null
}
/**
 * 日历工具结果 → 日程列表：认 `{events: [...]}` / 直接数组 / 编码过的 JSON 字符串。
 * 没有开始时刻的行整条丢掉（时间轴上没处放）；结束时刻缺省 = 开始时刻（一个瞬时点）。
 */
function parseCalendarEvents(result: unknown): readonly CalendarEvent[] {
  const direct = Array.isArray(result) ? result : null
  const record = direct
    ? null
    : (toRecord(result) ??
      (typeof result === 'string' ? toRecord(parseEmbeddedJson(result)) : null))
  const list = direct ?? (record ? findCalendarList(record) : null)
  if (!Array.isArray(list) || list.length === 0) return []

  const events: CalendarEvent[] = []
  for (let i = 0; i < list.length; i += 1) {
    const row = toRecord(list[i])
    if (!row) continue
    const startAt = firstNumber(row, [
      'startAt',
      'start_at',
      'start',
      'from',
      'beginAt',
      'begin_at'
    ])
    if (startAt === null) continue
    events.push({
      id: firstString(row, ['id', 'key', 'uid']) ?? 'calendar-' + String(i),
      title: firstString(row, ['title', 'summary', 'name', 'subject']) ?? '',
      startAt,
      endAt: firstNumber(row, ['endAt', 'end_at', 'end', 'to', 'finishAt']) ?? startAt,
      entireDay: row.entireDay === true || row.entire_day === true || row.allDay === true,
      notes: firstString(row, ['notes', 'note', 'description', 'location', 'place']) ?? ''
    })
  }
  return events
}

/** 本地时钟 `09:02`：不用 `toLocaleTimeString`（格式化随环境变，截图和单测都对不上） */
function toClockLabel(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = function (part: number): string {
    return part < 10 ? '0' + part : String(part)
  }
  return pad(date.getHours()) + ':' + pad(date.getMinutes())
}

interface TimelineLabels {
  timelineAllDay: string
  timelineUntitled: string
  timelineUntil: (clock: string) => string
}

/**
 * 日程 → 时间轴事件：左列开始时刻，说明里写「至 10:30」与备注，
 * `when` 由当前时刻判定 —— 正在进行的那场安排是唯一加粗的一条。
 */
function toTimelineEvents(
  events: readonly CalendarEvent[],
  now: number,
  labels: TimelineLabels
): readonly TimelineEvent[] {
  return events.map(function (event, index) {
    const start = toClockLabel(event.startAt)
    const end = event.entireDay ? '' : toClockLabel(event.endAt)
    const parts: string[] = []
    if (end && end !== start) parts.push(labels.timelineUntil(end))
    if (event.notes) parts.push(event.notes)
    return {
      id: event.id || 'calendar-' + String(index),
      when: toTimelineWhen(event.startAt, event.endAt, now),
      time: event.entireDay ? labels.timelineAllDay : start,
      title: event.title || labels.timelineUntitled,
      detail: parts.join(' · ')
    }
  })
}
/** 库内检索的命中列表键名（`{mode, channels, hits: [...]}`） */
const RETRIEVAL_HITS_KEYS = ['hits', 'results', 'chunks', 'passages'] as const

interface RetrievalHit {
  id: string
  source: string
  locator: string
  text: string
  score: number
  fuzzy: boolean
}

/**
 * 原始分数 → 0..1 相对相关度：最相关的那条记 1.00，其余按分数差线性压到 0.50–1.00。
 *
 * 为什么不直接报原始分：bm25 的绝对值跨查询不可比（负值域、受语料量影响），
 * 直接当百分比用会让人以为它跨次可比。所以只报「本次检索内的相对位置」。
 */
function toRelativeScores(scores: readonly number[]): number[] {
  if (scores.length === 0) return []
  const finite = scores.filter(function (score) {
    return Number.isFinite(score)
  })
  if (finite.length === 0) {
    return scores.map(function () {
      return 0
    })
  }
  // bm25：越小越相关
  const best = Math.min.apply(null, finite)
  const worst = Math.max.apply(null, finite)
  const spread = worst - best
  return scores.map(function (score) {
    if (!Number.isFinite(score)) return 0
    if (spread <= 0) return 1
    return 1 - ((score - best) / spread) * 0.5
  })
}

/**
 * 知识库检索结果 → 检索块要的命中行：标题 / 定位 / 片段 / 相对分数。
 *
 * 覆盖两种形状：工具直接返回的对象，和被序列化过的 JSON 字符串。
 * `mode === 'like'`（短词子串回退）时没有可信分数 → `fuzzy: true`，元素不画分数条。
 */
function parseRetrievalHits(result: unknown): readonly RetrievalHit[] {
  const record =
    toRecord(result) ?? (typeof result === 'string' ? toRecord(parseEmbeddedJson(result)) : null)
  if (!record) return []
  const list = RETRIEVAL_HITS_KEYS.map(function (key) {
    return record[key]
  }).find(function (value) {
    return Array.isArray(value)
  })
  if (!Array.isArray(list) || list.length === 0) return []

  const rawRows: Array<{
    id: string
    source: string
    locator: string
    text: string
    raw: number
    mode: string
  }> = []
  for (let i = 0; i < list.length; i += 1) {
    const row = toRecord(list[i])
    if (!row) continue
    const locator = firstString(row, ['relPath', 'rel_path', 'path', 'locator', 'section']) ?? ''
    const source =
      firstString(row, ['title', 'name', 'source', 'docTitle']) ??
      (locator ? findBaseName(locator) : null) ??
      '未命名文档'
    const text = firstString(row, ['snippet', 'text', 'content', 'excerpt']) ?? ''
    const id = firstString(row, ['docId', 'doc_id', 'id', 'chunkId']) ?? locator + '#' + String(i)
    const raw = typeof row.score === 'number' ? row.score : Number.NaN
    const mode = (firstString(row, ['mode']) ?? '').toLowerCase()
    rawRows.push({ id, source, locator, text, raw, mode })
  }
  if (rawRows.length === 0) return []

  const allLike = rawRows.every(function (row) {
    return row.mode === 'like'
  })
  const noScores = rawRows.every(function (row) {
    return !Number.isFinite(row.raw)
  })
  const fuzzy = allLike || noScores
  const relative = toRelativeScores(
    rawRows.map(function (row) {
      return row.raw
    })
  )

  return rawRows.map(function (row, index) {
    return {
      id: row.id,
      source: row.source,
      locator: row.locator,
      text: row.text,
      score: fuzzy ? 0 : relative[index],
      fuzzy
    }
  })
}

function mapToolCallState(props: ToolCallMessagePartProps): ToolCallState {
  const approval = props.approval
  if (approval && approval.approved === undefined && !approval.resolution) {
    return 'approval-requested'
  }
  if (approval?.approved === false || approval?.resolution === 'cancelled') {
    return 'output-denied'
  }
  if (approval?.approved === true || approval?.optionId) {
    return 'approval-responded'
  }
  if (props.isError || props.status?.type === 'incomplete') {
    return 'output-error'
  }
  if (props.status?.type === 'running') {
    return 'input-available'
  }
  if (props.status?.type === 'requires-action') {
    return 'approval-requested'
  }
  return 'output-available'
}

export {
  buildLineDiff,
  extractQuery,
  extractWebQuery,
  fetchWriteCodeDiff,
  findBaseName,
  findCodeLanguage,
  findWritePath,
  mapToolCallState,
  parseCalendarEvents,
  parseRetrievalHits,
  toClockLabel,
  toTimelineEvents,
  parseToolCard,
  parseToolCardAsync,
  parseToolOutputText,
  parseWebSources,
  parseWriteCodeDiff,
  parseWriteDiffStat,
  parseWriteTexts
}
export type {
  CalendarEvent,
  CodeHighlightLanguage,
  RetrievalHit,
  ParsedFileTreeNode,
  ParsedToolCard,
  ParsedToolSpecial,
  WebSource,
  WriteCodeDiff,
  WriteDiffKind,
  WriteDiffLine,
  WriteDiffStat
}
