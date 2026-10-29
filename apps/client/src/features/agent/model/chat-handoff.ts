/**
 * 磁贴 → 完整会话的一次性交接。
 *
 * 只在用户**明确**点「完整会话」时写入：dock 已经是默认路径，这里不是默认流转，
 * 而是「这一轮要在聊天页继续」的显式升级。取走即清空，避免刷新后反复覆盖输入框。
 */
import type { ScenarioKey } from '@/features/agent/model/scenarios'

interface ChatHandoff {
  text: string
  scenario: ScenarioKey
}

let handoff: ChatHandoff | null = null

function rememberChatHandoff(next: ChatHandoff): void {
  handoff = next
}

function takeChatHandoff(): ChatHandoff | null {
  const value = handoff
  handoff = null
  return value
}

export { rememberChatHandoff, takeChatHandoff }
export type { ChatHandoff }
