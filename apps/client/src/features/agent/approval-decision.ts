/**
 * 审批业务判定的 client 入口。
 *
 * 纯判定（`decideApproval`）已上提到 `@cogito/agent-runtime/policy` —— 浏览器扩展与
 * client 用的是同一份安全闸门，两端各写一版「只读档该不该拦写工具」迟早有一端写反。
 *
 * 这里只剩**读 client 自己的状态**：有效审批档（会话覆盖 → 全局偏好）、
 * 问答/计划是否锁写、是否目标推进中。
 */
import { decideApproval } from '@cogito/agent-runtime/policy'
import type {
  ApprovalDecisionInput,
  ApprovalOption,
  ApprovalOutcome
} from '@cogito/agent-runtime/policy'

import { findEffectiveApprovalMode, isReadOnlySession } from '@/features/agent/effective-approval'
import { readGoalRun } from '@/features/agent/goal-run'
import { readAgentModeFor } from '@/features/agent/mode'
import type { AgentMode } from '@/features/persist'

/**
 * 从 store 取上下文并判定（`port/session.ts` 的唯一入口）。
 *
 * `agentMode` 是**这一轮**的模式：调用方从消息快照算出来（重新生成要复现当初那一次），
 * 不传才读会话偏好。两处口径必须与 `findRunGooseMode` 一致，否则会出现
 * 「goose 拿 auto、我们却按计划档拒写」（F-013）。
 */
function decideApprovalForThread(
  threadID: string,
  toolName: string,
  options: readonly ApprovalOption[],
  agentMode?: AgentMode
): ApprovalOutcome {
  const goalActive = Boolean(readGoalRun(threadID))
  const mode = agentMode ?? readAgentModeFor(threadID)
  return decideApproval({
    toolName,
    approvalMode: findEffectiveApprovalMode(threadID),
    planning: mode === 'plan' && !goalActive,
    readOnlySession: isReadOnlySession(threadID, agentMode),
    goalActive,
    options
  })
}

export { decideApproval, decideApprovalForThread }
export type { ApprovalDecisionInput, ApprovalOption, ApprovalOutcome }
