/**
 * 委派长任务的领域模型（纯函数，可单测）。
 *
 * 服务端 agent 任务的生命周期与本地 goose 会话是两条路：这里只关心「任务提交之后」
 * 的那条——从 `AgentTask`（`GET /agent/tasks/{id}` 的台账行）派生 UI 阶段、判断要不要弹
 * 审批卡、把模型给的参数 JSON 字符串解回对象。副作用（轮询、发请求）在 `./use-delegation`。
 */
import type { AgentTask } from '@/apis/agent-task.ts'

/**
 * 委派任务的 UI 阶段。`submitted` 是「提交请求在途」，之后落在 `running` /
 * `awaiting_approval` / `settled` 三者之一，终态只看 `status`（进度有「落后一步」的特性，
 * 不拿它当终态信号）。
 */
type DelegationPhase = 'idle' | 'submitted' | 'running' | 'awaiting_approval' | 'settled'

/** 从台账行派生 UI 阶段：终态只看 `status`，待审批只看 `pendingApproval`。 */
function derivePhase(task: AgentTask | null): DelegationPhase {
  if (!task) return 'idle'
  if (task.status === 'SUCCEEDED' || task.status === 'FAILED') return 'settled'
  if (task.pendingApproval) return 'awaiting_approval'
  return 'running'
}

/** 任务是否已到终态（成功或失败）。 */
function isSettled(task: AgentTask): boolean {
  return task.status === 'SUCCEEDED' || task.status === 'FAILED'
}

/**
 * 当前是否要弹审批卡：有待审批、且这条审批**没被决定过**。
 *
 * 决定过的审批号进 `decided` 集合——服务端对同方向的重投会回 `applied=false`，但客户端
 * 不去赌那个：本地先记住「这条我处理过了」，轮询再撞到同一条就不重复弹窗。
 *
 * **不在这里判断过期**：审批超时是编排的收尾责任——过了 `expiresAt` 编排会自己把
 * `pendingApproval` 从进度里摘掉（任务退回 `running` 或直接终态），客户端跟着快照走即可，
 * 不必在渲染里读时钟（`expiresAt` 只用于展示逾期时间）。
 */
function isApprovalPrompting(task: AgentTask, decided: ReadonlySet<string>): boolean {
  const pending = task.pendingApproval
  if (!pending) return false
  return !decided.has(pending.approvalID)
}

/**
 * 把模型给的参数 JSON 字符串解回对象。`arguments` 是 OpenAI 工具调用的线格式（字符串），
 * 展示给审批者看时解成键值；解不出来（空串、非法 JSON、不是对象）一律回空对象——
 * 审批看的是「模型想干什么」，格式坏掉不该挡住审批动作。
 */
function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch (error) {
    console.warn('[delegate] 工具参数不是合法 JSON，回落空对象:', error)
    return {}
  }
}

export { derivePhase, isApprovalPrompting, isSettled, parseToolArguments }
export type { DelegationPhase }
