/**
 * 有效审批档：计划模式强制只读（不改用户偏好落盘），其余用会话审批偏好。
 */
import { readApprovalModeFor, type ApprovalMode } from '@/features/agent/approval'
import { readAgentModeFor } from '@/features/agent/mode'

function findEffectiveApprovalMode(
  threadID: string,
  override?: ApprovalMode
): ApprovalMode {
  if (override) return override
  if (readAgentModeFor(threadID) === 'plan') return 'readonly'
  return readApprovalModeFor(threadID)
}

export { findEffectiveApprovalMode }
