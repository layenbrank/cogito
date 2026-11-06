/**
 * 整轮活动流水的纯函数层：切段、状态映射、折叠条文案、时长与标签格式化。
 *
 * 这里不碰 React、不碰 DOM —— 外壳在 `run-activity.tsx`（元素本体），
 * 渲染契约在 `thread.aui.tsx`（`ThreadComponents.RunActivity`）。单独一个模块
 * 是为了把「一轮的 parts 怎么收成一条时间线」讲清楚，并且能直接单测
 * （与 `run-status.ts` / `tool-call-state.ts` 同一套做法）。
 */
import type {
  MessagePartStatus,
  MessageStatus,
  ToolCallMessagePartStatus
} from '@assistant-ui/react'

import type { AssistantLabels } from './labels'
import type { RunActivityStatus } from './run-activity'

/** 过程区的 part 只读这一段就够：切段按 `type`，折叠条的状态按 `status` */
interface PartLike {
  readonly type: string
  readonly status: MessagePartStatus | ToolCallMessagePartStatus
  readonly text?: string
  readonly toolName?: string
  readonly toolCallId?: string
}

/** 过程区的一「条」：解说 / 思考合并相邻段，工具与未知 part 各自独占 */
interface ActivitySegment {
  kind: 'commentary' | 'reasoning' | 'tool' | 'other'
  indices: number[]
}

/** 折叠条前缀要的文案（与 `RunNoteLabels` 同款：只取用得上的键） */
type RunActivityLabels = Pick<
  AssistantLabels,
  | 'runWorking'
  | 'runWorked'
  | 'runCompleted'
  | 'runNeedsAction'
  | 'runStopped'
  | 'runFailed'
  | 'runIncomplete'
>

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
 * 折叠条上的「最近一条活动」：取首行、抹掉 Markdown 记号、超长截断。
 * 流式时这段文字每个 token 都在变，只做纯字符串处理，不解析 Markdown。
 */
function toActivityLabel(text: string | undefined, maxLength = 48): string | undefined {
  if (!text) return undefined
  const firstLine = text.split(/\r?\n/).find(function (line) {
    return line.trim().length > 0
  })
  if (!firstLine) return undefined

  const plain = firstLine
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/`{1,3}/g, '')
    .replace(/[*_~]/g, '')
    // 抹掉记号后会留下双空格（`的 **实现**`），收成一格再 trim
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!plain) return undefined
  if (plain.length <= maxLength) return plain
  return `${plain.slice(0, maxLength - 1)}…`
}

/**
 * 按「条目」重切过程区：与 `toProcessRuns` 的区别是不再按类型分组折叠，
 * 而是一轮摊成一条时间线。工具一件一条（各自的 toolCallId 就是边界），
 * 未知 part（plan / file / image / data UI）也独占一条 —— 它们不是「活动」，
 * 会被放到折叠区外面常驻可见。
 */
function toActivitySegments(
  parts: readonly PartLike[],
  from: number,
  to: number
): ActivitySegment[] {
  const segments: ActivitySegment[] = []
  for (let index = from; index < to; index += 1) {
    const type = parts[index].type
    const kind: ActivitySegment['kind'] =
      type === 'tool-call'
        ? 'tool'
        : type === 'reasoning'
          ? 'reasoning'
          : type === 'text'
            ? 'commentary'
            : 'other'
    const last = segments[segments.length - 1]
    if (last && kind !== 'tool' && kind !== 'other' && last.kind === kind) {
      last.indices.push(index)
      continue
    }
    segments.push({ kind, indices: [index] })
  }
  return segments
}

/** 这条工具调用必须让用户看见：等审批，或者失败（用户自己取消不算失败） */
function partNeedsAttention(part: PartLike): boolean {
  const status = part.status
  if (status.type === 'requires-action') return true
  return status.type === 'incomplete' && status.reason !== 'cancelled'
}

/** message.status → 活动流水状态（`requires-action` 是「等人处理」，不是跑完了） */
function toRunActivityStatus(status: MessageStatus | undefined): RunActivityStatus {
  if (!status) return 'incomplete'
  if (status.type === 'running') return 'running'
  if (status.type === 'requires-action') return 'requires-action'
  if (status.type === 'complete') return 'complete'
  if (status.reason === 'cancelled') return 'cancelled'
  if (status.reason === 'error') return 'error'
  return 'incomplete'
}

/** 折叠条前缀：跑完但没有时长时退回「已完成」，不写「已工作」（后面没有数会读成没跑） */
function findRunStatusLabel(
  status: RunActivityStatus,
  labels: RunActivityLabels,
  hasDuration: boolean
): string {
  switch (status) {
    case 'running':
      return labels.runWorking
    case 'requires-action':
      return labels.runNeedsAction
    case 'complete':
      return hasDuration ? labels.runWorked : labels.runCompleted
    case 'cancelled':
      return labels.runStopped
    case 'error':
      return labels.runFailed
    default:
      return labels.runIncomplete
  }
}

export {
  findRunStatusLabel,
  formatRunDuration,
  partNeedsAttention,
  toActivityLabel,
  toActivitySegments,
  toRunActivityStatus
}
export type { ActivitySegment, PartLike, RunActivityLabels }
