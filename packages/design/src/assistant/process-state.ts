/**
 * 过程区的纯函数层：切块、块状态、结算文案。
 *
 * 「过程」= 最终回答之前的一切。它按原时序切成一块一块（思考一段一条、工具一件一行、
 * 解说各占一块），每块自己折叠 —— 见 `thread.aui.tsx` 的 `AssistantMessage`。
 * 这里不碰 React、不碰 DOM，只做纯计算，所以能直接单测（与 `run-status.ts` 同一套做法）。
 */
import type {
  MessagePartStatus,
  MessageStatus,
  ToolCallMessagePartStatus
} from '@assistant-ui/react'

/** 一条消息怎么结束的；`requires-action` 是「等人处理」，不是跑完了 */
type RunActivityStatus =
  'running' | 'requires-action' | 'complete' | 'cancelled' | 'error' | 'incomplete'

/** 过程区的 part 只读这一段就够：切块按 `type`，块状态按 `status` */
interface PartLike {
  readonly type: string
  readonly status: MessagePartStatus | ToolCallMessagePartStatus
  readonly text?: string
  readonly toolName?: string
  readonly toolCallId?: string
  /** 工具实参（折叠行上的提示从这里取，不读输出） */
  readonly args?: unknown
}

/** 过程区的一块：只有相邻的同类「活动」才合并，解说与未知 part 各占一块 */
interface ProcessRun {
  kind: 'tool' | 'reasoning' | 'single'
  indices: number[]
}

/** 块内各状态计数（结构上与 `ThreadGroupPart['counts']` 一致），计数之和 = indices.length */
interface ProcessRunCounts {
  running: number
  complete: number
  incomplete: number
  requiresAction: number
}

/**
 * 最终回答的起点：从末尾往回找**最后一段非空正文**，紧邻它的正文段一起算进来。
 *
 * 边界是**算出来的**，不要求模型标注「哪段是总结」（VS Code Copilot 的
 * `getFinalResponseStartIndex` 是同一思路）。找不到正文就返回 `parts.length`
 * —— 那一轮还没给出结论，整条都算过程。
 */
function findResponseStart(parts: readonly PartLike[]): number {
  let start = -1
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part.type !== 'text' || !part.text?.trim()) continue
    start = index
    break
  }
  if (start < 0) return parts.length

  while (start > 0 && parts[start - 1].type === 'text') start -= 1
  return start
}

/**
 * 按 part 类型切块：相邻的思考合成一块、相邻的工具合成一段（渲染时仍一件一行，
 * 只是给宿主留了「按组收起」的机会），其余 part 各占一块。
 */
function toProcessRuns(parts: readonly PartLike[], from: number, to: number): ProcessRun[] {
  const runs: ProcessRun[] = []
  for (let index = from; index < to; index += 1) {
    const type = parts[index].type
    const kind: ProcessRun['kind'] =
      type === 'tool-call' ? 'tool' : type === 'reasoning' ? 'reasoning' : 'single'
    const last = runs[runs.length - 1]
    if (last && kind !== 'single' && last.kind === kind) {
      last.indices.push(index)
      continue
    }
    runs.push({ kind, indices: [index] })
  }
  return runs
}

/** 块状态：有 part 在跑就是 running，否则随最后一个（与库的 `getGroupStatus` 同规则） */
function toRunStatus(
  parts: readonly PartLike[],
  indices: readonly number[]
): MessagePartStatus | ToolCallMessagePartStatus {
  for (const index of indices) {
    if (parts[index].status.type === 'running') return parts[index].status
  }
  const last = indices[indices.length - 1]
  return parts[last].status
}

/** 块内各状态计数（`ThreadGroupPart.counts` 所需），计数之和 = indices.length */
function toRunCounts(parts: readonly PartLike[], indices: readonly number[]): ProcessRunCounts {
  let running = 0
  let complete = 0
  let incomplete = 0
  let requiresAction = 0
  for (const index of indices) {
    switch (parts[index].status.type) {
      case 'running':
        running += 1
        break
      case 'complete':
        complete += 1
        break
      case 'requires-action':
        requiresAction += 1
        break
      default:
        incomplete += 1
        break
    }
  }
  return { running, complete, incomplete, requiresAction }
}

/** 结算时长：`4.8s` / `2m 13s` / `1h 4m`（与元素页示例文案同口径） */
function formatRunDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  if (ms < 1000) return '<1s'
  const seconds = ms / 1000
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * 折叠行上的提示：抹掉 Markdown 记号、压成一行。
 * 流式时这段文字每个 token 都在变，只做纯字符串处理，不解析 Markdown。
 */
function toPlainLine(line: string): string {
  return (
    line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+/, '')
      .replace(/`{1,3}/g, '')
      .replace(/[*_~]/g, '')
      // 抹掉记号后会留下双空格（`的 **实现**`），收成一格再 trim
      .replace(/\s{2,}/g, ' ')
      .trim()
  )
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
}

/**
 * 思考正文 → 折叠行上的「在想什么」：取**最后**一行。
 *
 * 为什么是最后一行而不是首行：思考是往后长的，最新那句才代表「现在在琢磨什么」；
 * 首行是这段思考的入口（常常是「让我先看看…」这类没有信息量的开场）。取不到就给
 * `undefined`，折叠行退回只写状态词，不留空占位符。
 */
function toThinkingHint(text: string | undefined, maxLength = 40): string | undefined {
  if (!text) return undefined
  const lines = text.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const plain = toPlainLine(lines[index])
    if (plain) return clipText(plain, maxLength)
  }
  return undefined
}

/** message.status → 回合状态（`requires-action` 是「等人处理」，不是跑完了） */
function toRunActivityStatus(status: MessageStatus | undefined): RunActivityStatus {
  if (!status) return 'incomplete'
  if (status.type === 'running') return 'running'
  if (status.type === 'requires-action') return 'requires-action'
  if (status.type === 'complete') return 'complete'
  if (status.reason === 'cancelled') return 'cancelled'
  if (status.reason === 'error') return 'error'
  return 'incomplete'
}

/** 实参里最值得写进一行的字段：路径 / 命令 / 查询词，取第一个命中 */
const TOOL_ARG_KEYS = [
  'path',
  'file_path',
  'filePath',
  'file',
  'filename',
  'command',
  'cmd',
  'pattern',
  'query',
  'url',
  'name'
] as const

/**
 * 工具实参 → 一行摘要（`src/main.ts` / `pnpm test`）。只读实参、不碰输出：
 * 收起态要回答的是「这一步动的是哪儿」，不是结果。
 */
function toToolArgDetail(args: unknown, maxLength = 48): string | undefined {
  if (typeof args === 'string') return toArgLine(args, maxLength)
  if (args === null || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const key of TOOL_ARG_KEYS) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const line = toArgLine(value, maxLength)
    if (line) return line
  }
  return undefined
}

/** 参数值 → 单行：多行命令压成一行（换行本身就是空白的另一种写法） */
function toArgLine(value: string, maxLength: number): string | undefined {
  const line = toPlainLine(value).replace(/\s+/g, ' ')
  return line ? clipText(line, maxLength) : undefined
}

/** 正文的第一行（解说只要开头那句就够，收起态没有整段的位置） */
function toFirstLine(text: string | undefined, maxLength = 48): string | undefined {
  if (!text) return undefined
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const plain = toPlainLine(line)
    if (plain) return clipText(plain, maxLength)
  }
  return undefined
}

/** 明细清单的一行：工具一件一条、思考一段一条、解说一块一条 */
type ProcessDigestEntry =
  | { kind: 'tool'; toolName: string; detail?: string }
  | { kind: 'thinking'; hint?: string }
  | { kind: 'note'; text?: string }

interface ProcessDigest {
  /** 按**渲染行**摊开的明细（工具一件一条），收起态直接照着排 */
  entries: ProcessDigestEntry[]
  tools: number
  thoughts: number
  notes: number
}

/**
 * 收起态要交代的「详细信息」：整轮过程摊成若干条明细 + 工具 / 思考 / 解说的条数。
 *
 * 为什么收起还要摊：只有「过程 · 6 步」等于让用户展开才能知道刚才干了什么，而展开
 * 一轮几十步又回不到结论。所以折的是**正文与输出**，不是「走过哪几步」。
 *
 * 非正文的 single 块（file / image / 自定义 data UI）不进清单 —— 它们没有一行文字能
 * 概括，硬编一个类型名只会更糊涂；展开后原位就在。
 */
function toProcessDigest(
  parts: readonly PartLike[],
  runs: readonly ProcessRun[],
  maxLength = 48
): ProcessDigest {
  const entries: ProcessDigestEntry[] = []
  let tools = 0
  let thoughts = 0
  let notes = 0

  for (const run of runs) {
    if (run.kind === 'tool') {
      for (const index of run.indices) {
        const part = parts[index]
        if (part.type !== 'tool-call') continue
        tools += 1
        const toolName = part.toolName ?? ''
        if (!toolName) continue
        entries.push({ kind: 'tool', toolName, detail: toToolArgDetail(part.args, maxLength) })
      }
      continue
    }

    if (run.kind === 'reasoning') {
      // 一段思考算一段：相邻 reasoning part 合并成**一行**（`toProcessRuns` 的口径），
      // 按 part 数会写成「3 段思考」却只列出一行，和「N 步」也对不上。
      thoughts += 1
      let hint: string | undefined
      for (let position = run.indices.length - 1; position >= 0; position -= 1) {
        const part = parts[run.indices[position]]
        if (part.type !== 'reasoning') continue
        hint = toThinkingHint(part.text, maxLength)
        if (hint) break
      }
      // 空白思考没有一行可写，只计数（清单里留一行「已思考」等于占位噪音）
      if (hint) entries.push({ kind: 'thinking', hint })
      continue
    }

    const part = parts[run.indices[0]]
    if (part?.type !== 'text') continue
    const text = toFirstLine(part.text, maxLength)
    if (!text) continue
    notes += 1
    entries.push({ kind: 'note', text })
  }

  return { entries, tools, thoughts, notes }
}

/**
 * 过程占几行：工具一件一行（默认不分组时每件都是一张卡），其余每块一行。
 * 「N 步」必须与真正渲染出来的行数对得上 —— 否则 5 次工具调用会被写成「1 步」。
 */
function toProcessRows(runs: readonly ProcessRun[]): number {
  let rows = 0
  for (const run of runs) rows += run.kind === 'tool' ? run.indices.length : 1
  return rows
}

export {
  findResponseStart,
  formatRunDuration,
  toProcessDigest,
  toProcessRows,
  toProcessRuns,
  toRunActivityStatus,
  toRunCounts,
  toRunStatus,
  toThinkingHint,
  toToolArgDetail
}
export type {
  PartLike,
  ProcessDigest,
  ProcessDigestEntry,
  ProcessRun,
  ProcessRunCounts,
  RunActivityStatus
}
