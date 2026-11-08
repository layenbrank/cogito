/**
 * 绑定计划 → 执行提示词（纯函数，可单测）。
 *
 * 与右栏「按计划执行」同源：`buildPlanExecutePrompt` 发计划正文全文，
 * 任务里的 `prompt` 只作可选附加说明，不能盖掉计划。
 */
import { buildPlanExecutePrompt } from '@/features/agent/plan-execute'
import type { AutomationMode } from '@/shared/ipc/specs/automation'

interface BoundPlanInput {
  /** 计划正文 */
  body: string
  overview?: string
  filePath: string
  /** 任务附加说明；空则不加 */
  note?: string | null
  mode: AutomationMode
  budget: number
}

function findBoundPlanTarget(mode: AutomationMode): 'agent' | 'goal' {
  return mode === 'agent' ? 'agent' : 'goal'
}

function buildBoundPlanPrompt(input: BoundPlanInput): string {
  const target = findBoundPlanTarget(input.mode)
  const execute = buildPlanExecutePrompt({
    body: input.body,
    overview: input.overview,
    filePath: input.filePath,
    target,
    budget: input.budget
  })
  const note = input.note?.trim()
  if (!note) return execute
  return [`## 附加说明`, note, '', execute].join('\n')
}

export { buildBoundPlanPrompt, findBoundPlanTarget }
export type { BoundPlanInput }
