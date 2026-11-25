/**
 * 子任务分派卡：`cogito_agent_spawn` → `elements/agent-handoff` + `elements/agent`。
 *
 * 一次 spawn 就是一次「控制权交接」：本会话把一段活交给一个子会话。
 * - 交接卡：`from` → `to`、交接原因（prompt 摘要）、带走的上下文（cwd / jobID）；
 *   工具落定（complete / incomplete）后 `settled` 为真——箭头转灰、目标药丸换成中性色。
 * - `agent` 卡：完整交接说明（prompt 全文）。摘要已经在上面一行，太短就不重复第二份。
 *
 * 映射只做一次且是纯函数（`toAgentHandoff`），便于单测；组件本身不猜状态。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import {
  Agent,
  AgentContent,
  AgentHeader,
  AgentInstructions
} from '@cogito/design/assistant/agent'
import { AgentHandoff } from '@cogito/design/assistant/agent-handoff'
import { cn } from 'cn'

interface SubagentHandoffModel {
  from: string
  to: string
  reason: string
  carried: string[]
  settled: boolean
  prompt: string
  /** 子会话标题（= 元素里的 `to`），完整 prompt 单独给 */
  title: string
}

const REASON_LIMIT = 140
const TITLE_LIMIT = 32

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readText(source: Record<string, unknown> | null, keys: readonly string[]): string {
  if (!source) return ''
  for (const key of keys) {
    const raw = source[key]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return ''
}

function shorten(text: string, limit: number): string {
  const single = text.replace(/\s+/g, ' ').trim()
  if (single.length <= limit) return single
  return `${single.slice(0, limit - 1)}…`
}

function firstLine(text: string): string {
  const line = text.split('\n').find(function (item) {
    return item.trim().length > 0
  })
  return line?.trim() ?? text.trim()
}

/**
 * 工具调用 → 交接卡数据。
 *
 * 字段来源（Rust `tools/agents.rs`）：
 * - 入参 `{ prompt, title?, cwd? }`；
 * - 结果 `{ jobID, title, status, promptPreview? }`（`wait`/`result` 也回同一形状）。
 */
function toAgentHandoff(
  args: unknown,
  result: unknown,
  options: { settled: boolean; from?: string }
): SubagentHandoffModel | null {
  const argsRecord = firstRecord(args)
  const resultRecord = firstRecord(result)
  const prompt = readText(argsRecord, ['prompt', 'instructions', 'task'])
  const title =
    readText(argsRecord, ['title']) ||
    readText(resultRecord, ['title']) ||
    shorten(firstLine(prompt), TITLE_LIMIT) ||
    '子任务'
  if (!prompt && !readText(resultRecord, ['title'])) return null

  const cwd = readText(argsRecord, ['cwd', 'workdir', 'cwdPath'])
  const jobID = readText(resultRecord, ['jobID', 'jobId', 'job_id'])
  const carried: string[] = []
  if (cwd) carried.push(`工作目录 ${cwd}`)
  if (jobID) carried.push(`任务 ${jobID}`)

  return {
    from: options.from?.trim() || '主 agent',
    to: shorten(title, TITLE_LIMIT),
    reason: shorten(firstLine(prompt) || title, REASON_LIMIT),
    carried,
    settled: options.settled,
    prompt,
    title: shorten(title, TITLE_LIMIT)
  }
}

function ToolCardSubagent(props: ToolCallMessagePartProps) {
  const settled = props.status?.type !== 'running' && props.status?.type !== 'requires-action'
  const model = toAgentHandoff(props.args, props.result, { settled })
  if (!model) return null

  // 交接说明与摘要不同时，才额外展开一张 agent 卡把全文交出来（同一段话不摆两份）
  const showBrief = model.prompt.length > model.reason.length

  return (
    <div
      data-slot="agent-subagent-card"
      className="my-1 flex flex-col gap-1.5">
      <AgentHandoff
        from={model.from}
        to={model.to}
        reason={model.reason}
        carried={model.carried}
        settled={model.settled}
      />
      {showBrief ? (
        <Agent className={cn('bg-background/60')}>
          <AgentHeader name={model.title} />
          <AgentContent>
            <AgentInstructions>{model.prompt}</AgentInstructions>
          </AgentContent>
        </Agent>
      ) : null}
    </div>
  )
}

export { ToolCardSubagent, toAgentHandoff }
export type { SubagentHandoffModel }
