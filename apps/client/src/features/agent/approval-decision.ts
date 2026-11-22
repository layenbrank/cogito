/**
 * 审批业务判定的 client 入口。
 *
 * 纯判定（`decideApproval`）已上提到 `@cogito/agent-runtime/policy` —— 浏览器扩展与
 * client 用的是同一份安全闸门，两端各写一版「只读档该不该拦写工具」迟早有一端写反。
 *
 * 这里只剩**读 client 自己的状态**：有效审批档（会话覆盖 → 全局偏好 → 计划模式强制只读）、
 * 是否计划模式、是否目标推进中。
 */
import { decideApproval } from '@cogito/agent-runtime/policy'
import type {
  ApprovalDecisionInput,
  ApprovalOption,
  ApprovalOutcome
} from '@cogito/agent-runtime/policy'

import { findEffectiveApprovalMode } from '@/features/agent/effective-approval'
import { readGoalRun } from '@/features/agent/goal-run'
import { readAgentModeFor } from '@/features/agent/mode'

/** 从 store 取上下文并判定（`port/session.ts` 的唯一入口）。 */
function decideApprovalForThread(
  threadID: string,
  toolName: string,
  options: readonly ApprovalOption[]
): ApprovalOutcome {
  return decideApproval({
    toolName,
    approvalMode: findEffectiveApprovalMode(threadID),
    planning: readAgentModeFor(threadID) === 'plan',
    goalActive: Boolean(readGoalRun(threadID)),
    options
  })
}

export { decideApproval, decideApprovalForThread }
export type { ApprovalDecisionInput, ApprovalOption, ApprovalOutcome }
