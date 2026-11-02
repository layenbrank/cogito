/**
 * 工具结果启发式解析：一次抽正文，再按工具族只跑允许的 P1 解析器。
 *
 * 写工具行级 diff：同步 `buildLineDiff` 留给测试 / 首屏；Tauri 下 UI 走
 * `fetchWriteCodeDiff` → `agentTool:lineDiff`。
 */
import type { ToolCallState } from '@cogito/design/assistant/tool-call-state'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { invoke } from '@tauri-apps/api/core'

import {
  isCodeTool,
  isReadTool,
  isSearchTool,
  isShellTool,
  isWebTool,
  isWriteTool,
  type ToolCardVariant
} from '@/features/agent/tool-labels'
import { CHANNELS } from '@/shared/ipc/channels'
import { formatTerminalText, normalizeToolOutput, toShellCommand } from './tool-output'

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

const STACK_LINE =
  /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$|^\s*at\s+(.+):(\d+):(\d+)\s*$/
const COMMIT_HASH = /\b[0-9a-f]{7,40}\b/i
const VITEST_SUMMARY =
  /Tests?\s+(\d+)\s+passed(?:.*?(\d+)\s+failed)?(?:.*?(\d+)\s+skipped)?/i
const VITEST_ALT = /(\d+)\s+passed(?:.*?(\d+)\s+failed)?(?:.*?(\d+)\s+skipped)?/i
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/
const HTTP_URL = /https?:\/\/[^\s)\]"']+/g

/** shell / ACP 常见结果字段，绝不能当成环境变量名 */
const SHELL_RESULT_KEYS = new Set([
  'stdout',
  'stderr',
  'output',
  'exit_code',
  'exitCode',
  'status',
  'code',
  'error',
  'content',
  'result',
  'message',
  'data'
])

type ToolFamily = 'shell' | 'code' | 'files' | 'web' | 'generic'
type SpecialKind = ParsedToolSpecial['kind']

interface ParsedCommitFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
}

interface ParsedCommit {
  hash: string
  message: string
  files: readonly ParsedCommitFile[]
}

interface ParsedTestSummary {
  passed: number
  failed: number
  skipped: number
  total: number
  duration?: number
}

interface ParsedEnvEntry {
  name: string
  value: string
}

interface ParsedPackageInfo {
  name?: string
  currentVersion?: string
  newVersion?: string
  changeType?: 'major' | 'minor' | 'patch'
}

interface ParsedSchemaDisplay {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  description?: string
  parameters?: readonly {
    name: string
    type: string
    required?: boolean
    description?: string
    location?: 'path' | 'query' | 'header'
  }[]
}

interface ParsedFileTreeNode {
  path: string
  isDirectory: boolean
}

type ParsedToolSpecial =
  | { kind: 'commit'; data: ParsedCommit }
  | { kind: 'test'; data: ParsedTestSummary }
  | { kind: 'stack'; data: string }
  | { kind: 'package'; data: ParsedPackageInfo }
  | { kind: 'env'; data: readonly ParsedEnvEntry[] }
  | { kind: 'schema'; data: ParsedSchemaDisplay }
  | { kind: 'snippet'; data: string }
  | { kind: 'tree'; data: readonly ParsedFileTreeNode[] }

interface WebSource {
  title: string
  href: string
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

/** 各工具族允许的 P1 解析器（按优先级）；未列入的族不跑无效启发式 */
const SPECIAL_KINDS: Readonly<Record<ToolFamily, readonly SpecialKind[]>> = {
  shell: ['stack', 'commit', 'test'],
  code: ['stack', 'test'],
  files: ['tree', 'stack'],
  web: [],
  generic: ['stack', 'commit', 'test', 'env', 'package', 'schema', 'tree', 'snippet']
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
  if (isWriteTool(toolName)) return 'write'
  if (isSearchTool(toolName)) return 'search'
  if (isReadTool(toolName)) return 'read'
  return 'generic'
}

function parseCommitOutput(text: string, toolName: string): ParsedCommit | null {
  const lower = toolName.toLowerCase()
  if (!lower.includes('git') && !lower.includes('commit')) return null
  const hashMatch = text.match(COMMIT_HASH)
  if (!hashMatch) return null

  const lines = text.split('\n')
  const files: ParsedCommitFile[] = []
  let message: string | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    // `??`/`!!` 是 git status 的 untracked / ignored 行，同样属于文件清单，
    // 否则会被当成提交标题渲染到 header 右侧
    const fileMatch =
      line.match(/^([AMDRT])\s+(.+)$/) ?? line.match(/^(\?\?|!!)\s+(.+)$/)
    if (fileMatch) {
      const code = fileMatch[1]
      const path = fileMatch[2].trim()
      const status =
        code === 'A' || code === '??'
          ? 'added'
          : code === 'D'
            ? 'deleted'
            : code === 'R' || code === 'T'
              ? 'renamed'
              : 'modified'
      files.push({ path, status })
      continue
    }
    if (
      message === null &&
      !STACK_LINE.test(line) &&
      !COMMIT_HASH.test(line)
    ) {
      message = line
    }
  }

  // 没解析出文件清单就不是 commit 卡：git show / diff 的头部很容易被误判成提交，
  // 交回普通文本渲染反而更准确，也不会留下空的内容区
  if (files.length === 0) return null

  return {
    hash: hashMatch[0].slice(0, 7),
    message: message ?? '提交',
    files
  }
}

function parseVitestOutput(text: string): ParsedTestSummary | null {
  const match = text.match(VITEST_SUMMARY) ?? text.match(VITEST_ALT)
  if (!match) return null
  const passed = Number(match[1] ?? 0)
  const failed = Number(match[2] ?? 0)
  const skipped = Number(match[3] ?? 0)
  const total = passed + failed + skipped
  if (total === 0) return null

  const durationMatch = text.match(/(\d+(?:\.\d+)?)\s*(ms|s)\b/i)
  let duration: number | undefined
  if (durationMatch) {
    const value = Number(durationMatch[1])
    duration = durationMatch[2].toLowerCase() === 's' ? value * 1000 : value
  }

  return { passed, failed, skipped, total, duration }
}

function parseStackOutput(text: string): string | null {
  let hits = 0
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (STACK_LINE.test(lines[i])) {
      hits += 1
      if (hits >= 2) return text
    }
  }
  return null
}

function parseEnvOutput(text: string, result: unknown): readonly ParsedEnvEntry[] | null {
  const record = toRecord(result)
  if (record) {
    const keys = Object.keys(record)
    for (let i = 0; i < keys.length; i += 1) {
      if (SHELL_RESULT_KEYS.has(keys[i])) return null
    }

    const entries: ParsedEnvEntry[] = []
    for (let i = 0; i < keys.length; i += 1) {
      const name = keys[i]
      const value = record[name]
      if (!ENV_NAME.test(name)) continue
      if (typeof value !== 'string' && typeof value !== 'number') continue
      entries.push({ name, value: String(value) })
    }
    if (entries.length >= 2 && entries.length >= keys.length - 1) return entries
  }

  const lines = text.split('\n')
  const parsed: ParsedEnvEntry[] = []
  let nonEmpty = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    nonEmpty += 1
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const name = line.slice(0, eq).trim()
    if (!ENV_NAME.test(name)) continue
    parsed.push({ name, value: line.slice(eq + 1).trim() })
  }
  if (parsed.length < 2) return null
  if (parsed.length < nonEmpty * 0.8) return null
  return parsed
}

function parsePackageOutput(text: string, result: unknown): ParsedPackageInfo | null {
  const record = toRecord(result)
  const name =
    (record && firstString(record, ['name', 'package'])) ??
    (text.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? undefined)
  const currentVersion =
    record && firstString(record, ['currentVersion', 'from', 'oldVersion'])
  const newVersion = record && firstString(record, ['newVersion', 'to', 'version'])
  if (!name && !currentVersion && !newVersion) {
    const versionBump = text.match(/(\d+\.\d+\.\d+)\s*→\s*(\d+\.\d+\.\d+)/)
    if (!versionBump) return null
    return { currentVersion: versionBump[1], newVersion: versionBump[2] }
  }
  return {
    name: name ?? undefined,
    currentVersion: currentVersion ?? undefined,
    newVersion: newVersion ?? undefined
  }
}

function parseSchemaOutput(text: string, result: unknown): ParsedSchemaDisplay | null {
  const record = toRecord(result)
  const methodRaw =
    (record && firstString(record, ['method', 'httpMethod'])) ??
    text.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/i)?.[1]
  const pathMatch = text.match(/\/[\w./\-{}:]+/)
  const path =
    (record && firstString(record, ['path', 'route', 'url'])) ?? pathMatch?.[0] ?? null
  if (!methodRaw || !path) return null
  const method = methodRaw.toUpperCase() as ParsedSchemaDisplay['method']
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null

  const parameters = record?.parameters
  if (Array.isArray(parameters) && parameters.length > 0) {
    const mapped: NonNullable<ParsedSchemaDisplay['parameters']>[number][] = []
    for (let i = 0; i < parameters.length; i += 1) {
      const row = toRecord(parameters[i])
      if (!row || typeof row.name !== 'string') continue
      mapped.push({
        name: row.name,
        type: typeof row.type === 'string' ? row.type : 'string',
        required: row.required === true,
        description: typeof row.description === 'string' ? row.description : undefined
      })
    }
    return {
      method,
      path,
      description: record && typeof record.description === 'string' ? record.description : undefined,
      parameters: mapped
    }
  }

  return { method, path }
}

function parseSnippetOutput(text: string, args: unknown): string | null {
  const shell = toShellCommand(args)
  if (!shell) return null
  if (shell.command.includes('\n')) return null
  let outputLines = 0
  const chunks = text.split('\n')
  for (let i = 0; i < chunks.length; i += 1) {
    if (chunks[i]) {
      outputLines += 1
      if (outputLines > 1) return null
    }
  }
  return shell.command
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

function parseSpecialKind(
  kind: SpecialKind,
  context: SpecialParseContext
): ParsedToolSpecial | null {
  const { text, toolName, args, result } = context
  switch (kind) {
    case 'stack': {
      const data = parseStackOutput(text)
      return data ? { kind, data } : null
    }
    case 'commit': {
      const data = parseCommitOutput(text, toolName)
      return data && (data.files.length > 0 || data.message) ? { kind, data } : null
    }
    case 'test': {
      const data = parseVitestOutput(text)
      return data ? { kind, data } : null
    }
    case 'env': {
      const data = parseEnvOutput(text, result)
      return data ? { kind, data } : null
    }
    case 'package': {
      const data = parsePackageOutput(text, result)
      return data ? { kind, data } : null
    }
    case 'schema': {
      const data = parseSchemaOutput(text, result)
      return data ? { kind, data } : null
    }
    case 'tree': {
      const data = parseTreeOutput(text, toolName, result)
      return data ? { kind, data } : null
    }
    case 'snippet': {
      const data = parseSnippetOutput(text, args)
      return data ? { kind, data } : null
    }
    default:
      return null
  }
}

/** 一次抽正文 + 按族跑 P1；避免 tool-card 重复 formatTerminalText / 跑无关解析器 */
function parseToolCard(toolName: string, args: unknown, result: unknown): ParsedToolCard {
  const text = parseToolOutputText(result)
  const base = findBaseVariant(toolName)
  if (!text && result === undefined) {
    return { text: '', special: null, variant: base }
  }

  const family = findToolFamily(toolName)
  const kinds = SPECIAL_KINDS[family]
  const context: SpecialParseContext = { text, toolName, args, result }
  for (let i = 0; i < kinds.length; i += 1) {
    const special = parseSpecialKind(kinds[i], context)
    if (special) return { text, special, variant: special.kind }
  }
  return { text, special: null, variant: base }
}

/** @deprecated 测试 / 旧调用点；新代码用 parseToolCard */
function parseToolSpecial(
  toolName: string,
  args: unknown,
  result: unknown
): ParsedToolSpecial | null {
  return parseToolCard(toolName, args, result).special
}

/** @deprecated 测试 / 旧调用点；新代码用 parseToolCard */
function findToolCardVariant(
  toolName: string,
  special: ParsedToolSpecial | null
): ToolCardVariant {
  if (special) {
    const family = findToolFamily(toolName)
    if (SPECIAL_KINDS[family].includes(special.kind)) return special.kind
  }
  return findBaseVariant(toolName)
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
  const kinds = SPECIAL_KINDS[family]
  const context: SpecialParseContext = { text, toolName, args, result }
  for (let i = 0; i < kinds.length; i += 1) {
    const special = parseSpecialKind(kinds[i], context)
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

function parseWebSources(
  toolName: string,
  args: unknown,
  result: unknown,
  outputText?: string
): readonly WebSource[] {
  if (!isWebTool(toolName)) return []
  const sources: WebSource[] = []
  const record = toRecord(args)
  const url = record && firstString(record, ['url', 'href', 'uri'])
  const query = record && firstString(record, ['query', 'q', 'search'])
  if (url) sources.push({ title: query ?? url, href: url })

  const text = outputText ?? parseToolOutputText(result)
  const urlMatches = text.match(HTTP_URL)
  if (!urlMatches) return sources

  const seen = new Set(sources.map(function (item) {
    return item.href
  }))
  for (let i = 0; i < urlMatches.length; i += 1) {
    const href = urlMatches[i]
    if (seen.has(href)) continue
    seen.add(href)
    sources.push({ title: href, href })
  }
  return sources
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
  fetchWriteCodeDiff,
  findBaseName,
  findCodeLanguage,
  findToolCardVariant,
  findWritePath,
  mapToolCallState,
  parseToolCard,
  parseToolCardAsync,
  parseToolOutputText,
  parseToolSpecial,
  parseWebSources,
  parseWriteCodeDiff,
  parseWriteDiffStat
}
export type {
  CodeHighlightLanguage,
  ParsedCommit,
  ParsedCommitFile,
  ParsedEnvEntry,
  ParsedFileTreeNode,
  ParsedPackageInfo,
  ParsedSchemaDisplay,
  ParsedTestSummary,
  ParsedToolCard,
  ParsedToolSpecial,
  WebSource,
  WriteCodeDiff,
  WriteDiffKind,
  WriteDiffLine,
  WriteDiffStat
}
