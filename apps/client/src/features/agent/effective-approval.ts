/**
 * 有效审批档：计划模式强制只读（不改用户偏好落盘），其余用会话审批偏好。
 */
import { readApprovalModeFor, type ApprovalMode } from '@/features/agent/approval'
import { readGoalRun } from '@/features/agent/goal-run'
import { readAgentModeFor } from '@/features/agent/mode'

function findEffectiveApprovalMode(
  threadID: string,
  override?: ApprovalMode
): ApprovalMode {
  if (override) return override
  // 计划模式强制只读，**但目标推进期间除外**：那边本身就是无人值守的长任务，
  // 把审批打回只读等于让所有写工具 never_allow，目标必然停在半路。
  if (readAgentModeFor(threadID) === 'plan' && !readGoalRun(threadID)) return 'readonly'
  return readApprovalModeFor(threadID)
}

export { findEffectiveApprovalMode }
