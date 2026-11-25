/**
 * 有效审批档：会话里用户选的询问 / 自动 / 只读，不因计划或问答被改写。
 *
 * 问答和计划的「不能写」不走审批档，走 `decideApproval` 的只读能力面。
 * 发给 goose 的档见 `findRunGooseMode`：这两档必须是 `approve`，否则自动审批会直接放行写工具。
 * 不用 goose 的 `chat`：新版本已删除该档，旧版本则是零工具，问答连文件都读不了。
 */
import { findGooseMode, readApprovalModeFor, type ApprovalMode } from '@/features/agent/approval'
import { readGoalRun } from '@/features/agent/goal-run'
import { readAgentModeFor } from '@/features/agent/mode'
import type { AgentMode } from '@/features/persist'

function findEffectiveApprovalMode(
  threadID: string,
  override?: ApprovalMode
): ApprovalMode {
  if (override) return override
  return readApprovalModeFor(threadID)
}

/**
 * 问答 / 计划（且不在目标推进中）只读，goose 必须先问我们，不能走 `auto` 或 `chat`。
 *
 * `agentMode` 是**这一轮**的模式（调用方从消息快照算出）。不传才读会话偏好 ——
 * 重新生成老消息时两者可能不同：快照说「执行」而偏好已经切到「计划」，
 * 若按偏好锁只读，提示词要它动手、审批却一律拒绝（F-013）。
 */
function isReadOnlySession(threadID: string, agentMode?: AgentMode): boolean {
  if (readGoalRun(threadID)) return false
  const mode = agentMode ?? readAgentModeFor(threadID)
  return mode === 'ask' || mode === 'plan'
}

/** 这一轮实际发给 goose 的会话档。 */
function findRunGooseMode(threadID: string, agentMode?: AgentMode): string {
  if (isReadOnlySession(threadID, agentMode)) return 'approve'
  return findGooseMode(findEffectiveApprovalMode(threadID))
}

export { findEffectiveApprovalMode, findRunGooseMode, isReadOnlySession }
