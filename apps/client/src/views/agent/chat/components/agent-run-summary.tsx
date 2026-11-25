/**
 * 回合小结（`ThreadComponents.RunSummary`）的落地：**改了什么** + **派了谁**。
 *
 * 两块都只在回合跑完之后才挂（库侧约束），并且各自没有内容就返回 `null`：
 * - `AgentFileChangeTree`：这一轮写过的文件（`elements/file-tree`）；
 * - `SubagentList`：这一轮 `cogito_agent_spawn` 派出去的子任务名册（`elements/subagent-list`）。
 *
 * 名册的「进度」只有两档：工具调用还在跑 = 0，已落定 = 100 —— 工具结果里没有百分比，
 * 不编一个假的分段进度。子会话与父会话同 provider / model，所以模型标签直接取不传
 * （元素在 `model` 为空时不渲染徽标）。
 */
import { SubagentList, type SubagentItem } from '@cogito/design/assistant/subagent-list'
import type { ThreadRunSummaryProps } from '@cogito/design/assistant/thread.aui'
import { useMemo } from 'react'

import { AgentFileChangeTree } from '@/views/agent/chat/components/file-change-tree'

interface SubagentPartView {
  toolName?: unknown
  args?: unknown
  result?: unknown
  status?: { type?: unknown }
}

const SPAWN_TOOL = 'agent_spawn'
const TITLE_LIMIT = 40

/**
 * 只认「工具调用 + 名字里有 `agent_spawn`」的 part。
 *
 * 入参取 `unknown`：`ThreadRunSummaryProps.parts` 只声明了 `{ type }`，
 * 实际字段在运行时才有 —— 在这里一次窄化完，调用方（含测试）不必写断言。
 */
function isSpawnCall(part: unknown): part is SubagentPartView & { type: string } {
  if (!part || typeof part !== 'object') return false
  const record = part as Record<string, unknown>
  if (record.type !== 'tool-call') return false
  const name = record.toolName
  return typeof name === 'string' && name.toLowerCase().includes(SPAWN_TOOL)
}

function textField(source: unknown, keys: readonly string[]): string {
  if (!source || typeof source !== 'object') return ''
  const record = source as Record<string, unknown>
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return ''
}

function shorten(text: string, limit: number): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`
}

function isSettled(status: { type?: unknown } | undefined): boolean {
  return status?.type !== 'running' && status?.type !== 'requires-action'
}

/**
 * 一条消息的 part → 子任务名册。
 *
 * 没有派发时返回 `null`（调用方据此不渲染），有派发时按出现顺序给三份等长数组。
 */
function toSubagentRoster(parts: readonly unknown[]): {
  agents: SubagentItem[]
  completedCount: number
  progress: number[]
} | null {
  const agents: SubagentItem[] = []
  const progress: number[] = []
  let completedCount = 0

  for (const part of parts) {
    if (!isSpawnCall(part)) continue
    const view = part
    const title =
      textField(view.args, ['title']) ||
      textField(view.result, ['title']) ||
      textField(view.args, ['prompt']) ||
      '子任务'
    agents.push({ name: shorten(title, TITLE_LIMIT), model: '' })
    const settled = isSettled(view.status)
    progress.push(settled ? 100 : 0)
    if (settled) completedCount += 1
  }

  if (agents.length === 0) return null
  // `completedCount` 从队首算完成：把已落定的挪到前面，勾才落在对的卡上
  const ordered: SubagentItem[] = []
  const orderedProgress: number[] = []
  for (let index = 0; index < agents.length; index += 1) {
    if (progress[index] === 100) {
      ordered.push(agents[index])
      orderedProgress.push(100)
    }
  }
  for (let index = 0; index < agents.length; index += 1) {
    if (progress[index] !== 100) {
      ordered.push(agents[index])
      orderedProgress.push(0)
    }
  }
  return { agents: ordered, completedCount, progress: orderedProgress }
}

function AgentSubagents(props: { parts: readonly { readonly type: string }[] }) {
  const roster = useMemo(
    function () {
      return toSubagentRoster(props.parts)
    },
    [props.parts]
  )
  if (!roster) return null
  return (
    <SubagentList
      agents={roster.agents}
      completedCount={roster.completedCount}
      progress={roster.progress}
      showSummary={false}
      summaryAgent={{ name: '', model: '' }}
      className="mt-2"
    />
  )
}

function AgentRunSummary(props: ThreadRunSummaryProps) {
  return (
    <>
      <AgentFileChangeTree parts={props.parts} />
      <AgentSubagents parts={props.parts} />
    </>
  )
}

export { AgentRunSummary, AgentSubagents, toSubagentRoster }
