/** 跨路由的「预设提示」单槽：指令库 → 智能体聊天（directive 场景）。 */
import type { ScenarioKey } from '@/features/agent/model/scenarios'

interface PendingPrompt {
  text: string
  scenario: ScenarioKey
}

let pendingPrompt: PendingPrompt | null = null

function setNextPrompt(next: PendingPrompt): void {
  pendingPrompt = next
}

/** 取走（只生效一次，避免刷新后反复覆盖输入框） */
function takeNextPrompt(): PendingPrompt | null {
  const value = pendingPrompt
  pendingPrompt = null
  return value
}

export { setNextPrompt, takeNextPrompt }
export type { PendingPrompt }
