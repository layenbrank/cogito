import { useAuiState, useMessageTiming, type MessageTiming } from '@assistant-ui/react'
import {
  TraceWaterfall,
  type TraceSpan
} from '@cogito/design/assistant/trace-waterfall.aui'

/**
 * 只取投影需要的字段：assistant-ui 的 part 是联合类型，
 * 这里按结构收敛，避免在纯函数里处理整套 part 类型。
 */
type TracablePart = {
  type: string
  timing?: { startedAt: number; completedAt?: number }
  status?: { type: string }
  toolCallId?: string
  toolName?: string
}

function findSpanStatus(statusType: string | undefined): TraceSpan['status'] {
  if (statusType === 'running') return 'running'
  if (statusType === 'complete') return 'completed'
  return 'failed'
}

function findSpanName(part: TracablePart): string {
  if (part.type === 'tool-call') return part.toolName ?? '工具'
  return '思考'
}

function buildMessageSpans(
  parts: readonly TracablePart[],
  timing: MessageTiming | undefined
): TraceSpan[] {
  const totalMs = timing?.totalStreamTime ?? 0
  const spans: TraceSpan[] = [
    {
      id: 'message',
      name: '消息',
      depth: 0,
      startMs: 0,
      durationMs: totalMs,
      status: totalMs > 0 ? 'completed' : 'running'
    }
  ]

  for (const [index, part] of parts.entries()) {
    const isTracable = part.type === 'tool-call' || part.type === 'reasoning'
    if (!isTracable || !part.timing) continue
    const streamStart = timing?.streamStartTime ?? part.timing.startedAt
    spans.push({
      id: part.type === 'tool-call' ? `tool-${part.toolCallId ?? index}` : `reasoning-${index}`,
      name: findSpanName(part),
      depth: 1,
      startMs: Math.max(0, part.timing.startedAt - streamStart),
      durationMs: part.timing.completedAt
        ? part.timing.completedAt - part.timing.startedAt
        : 0,
      status: findSpanStatus(part.status?.type)
    })
  }

  return spans
}

/**
 * 从 message timing + part timing 投影出轨迹瀑布的 spans。
 * assistant-ui 不建模嵌套 span，只有「消息」与「消息内的工具 / 思考」两级，够画两层瀑布。
 */
function useMessageTrace(): { spans: TraceSpan[]; totalMs: number } {
  const timing = useMessageTiming()
  const parts = useAuiState(function (state) {
    return state.message.parts
  })
  return {
    spans: buildMessageSpans(parts, timing),
    totalMs: timing?.totalStreamTime ?? 0
  }
}

/** 消息轨迹瀑布：多于一条 span 才显示 */
function MessageTrace() {
  const { spans, totalMs } = useMessageTrace()
  if (spans.length <= 1) return null
  return <TraceWaterfall spans={spans} totalMs={totalMs} visibleCount={spans.length} />
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** 消息级指标：TTFT / 速度 / token / 工具数（timing 终态时才有，纯文本回合也能展示） */
function MessageTimingStats() {
  const timing = useMessageTiming()
  if (!timing) return null

  const ttftMs =
    timing.firstTokenTime === undefined
      ? undefined
      : Math.max(0, timing.firstTokenTime - timing.streamStartTime)

  const stats: { label: string; value: string }[] = []
  if (ttftMs !== undefined) stats.push({ label: '首字', value: formatMs(ttftMs) })
  if (timing.tokensPerSecond !== undefined)
    stats.push({ label: '速度', value: `${timing.tokensPerSecond} tok/s` })
  if (timing.tokenCount !== undefined) stats.push({ label: 'Token', value: String(timing.tokenCount) })
  if (timing.toolCallCount > 0) stats.push({ label: '工具', value: String(timing.toolCallCount) })

  if (stats.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 text-xs">
      {stats.map(function (stat) {
        return (
          <span
            key={stat.label}
            className="text-muted-foreground flex items-baseline gap-1">
            {stat.label}
            <span className="text-foreground font-mono tabular-nums">{stat.value}</span>
          </span>
        )
      })}
    </div>
  )
}

export { MessageTimingStats, MessageTrace, useMessageTrace }
