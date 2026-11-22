/**
 * 审批与追问的回执，以及「票据」的内存账本。
 *
 * ## 为什么票据必须按 `toolCallId` 定位，而不是「当前会话」
 *
 * 端口与工具卡是两个组件树分支，而一个会话可能在后台继续跑 —— 用户点下去的时候，
 * 「当前会话」早已经是别人了。所以票据里必须带 `threadID`；靠遍历会话表去找票据，
 * 一旦记录不在表里就永远返回 `false`，UI 只能报「已失效」，而 agentd 那边的票据
 * 还挂着整整 300s。
 *
 * ## 为什么回执要两条路都走
 *
 * `allow_always` / `reject_always` 会被 goose 写进 `permission.yaml` 的 `user` 段，
 * 那是全进程持久的用户偏好：一次自动放行会变成永久放行。替用户拍板只能是「这一次」，
 * 所以派生选项时只认 `once`。
 */

import type { CreateElicitationResponse } from '@agentclientprotocol/sdk'

import { AGENTD_ROUTES } from './runs'
import type { AgentdTransport } from './transport'

/** 待审批票据：`toolCallId → 票据` */
interface ApprovalTicket {
  threadID: string
  requestId: string
  /** 该票据可选的 `optionId` 列表（回执时按 allow / reject 派生） */
  options: readonly string[]
}

interface ApprovalTakeInput {
  approved: boolean
  optionId?: string | null
}

interface ApprovalTaken {
  ticket: ApprovalTicket
  approved: boolean
  optionId: string | null
}

interface ApprovalLedger {
  remember: (toolCallId: string, ticket: ApprovalTicket) => void
  forget: (toolCallId: string) => void
  findTicket: (toolCallId: string) => ApprovalTicket | null
  /** `'pending'` / 已拍板的布尔结果 / `null`（从没见过这张票据） */
  findState: (toolCallId: string) => 'pending' | boolean | null
  markSettled: (toolCallId: string, approved: boolean) => void
  /**
   * 取走票据并给出回执要用的 optionId。
   *
   * 返回 `null` 表示票据不存在（调用方据此如实告诉用户「已失效」，而不是假报成功）。
   */
  take: (toolCallId: string, input: ApprovalTakeInput) => ApprovalTaken | null
}

const SETTLED_APPROVALS_CAP = 256

/**
 * 按「允许 / 拒绝」派生回执选项。
 *
 * **必须先找 `*_once`**：goose 下发的顺序是 `allow_always, allow_once, reject_once,
 * reject_always`，用一个 `/allow/` 正则去 `find` 会先命中 `allow_always` —— 用户只点了
 * 一次「允许」，却把这条工具永久放进了 `permission.yaml` 的 `user` 段。这正是审批判定
 * 反复强调「替用户拍板只能是这一次」要防的事。
 */
function deriveOption(options: readonly string[], approved: boolean): string | null {
  const once = approved ? 'allow_once' : 'reject_once'
  const exact = options.find(function (optionId) {
    return optionId === once
  })
  if (exact) return exact
  const pattern = approved ? /allow/ : /reject/
  return (
    options.find(function (optionId) {
      return pattern.test(optionId)
    }) ?? null
  )
}

function createApprovalLedger(): ApprovalLedger {
  const pending = new Map<string, ApprovalTicket>()
  /** 已拍板结果：`toolCallId → approved`。容量封顶，避免长会话无限增长 */
  const settled = new Map<string, boolean>()

  function markSettled(toolCallId: string, approved: boolean): void {
    settled.set(toolCallId, approved)
    if (settled.size <= SETTLED_APPROVALS_CAP) return
    const oldest = settled.keys().next().value
    if (oldest !== undefined) settled.delete(oldest)
  }

  function findState(toolCallId: string): 'pending' | boolean | null {
    if (pending.has(toolCallId)) return 'pending'
    const value = settled.get(toolCallId)
    return value === undefined ? null : value
  }

  function take(toolCallId: string, input: ApprovalTakeInput): ApprovalTaken | null {
    const ticket = pending.get(toolCallId)
    if (!ticket) return null
    pending.delete(toolCallId)
    const derived = input.optionId ?? deriveOption(ticket.options, input.approved)
    markSettled(toolCallId, input.approved)
    return { ticket, approved: input.approved, optionId: derived }
  }

  return {
    remember(toolCallId: string, ticket: ApprovalTicket) {
      pending.set(toolCallId, ticket)
    },
    forget(toolCallId: string) {
      pending.delete(toolCallId)
    },
    findTicket(toolCallId: string) {
      return pending.get(toolCallId) ?? null
    },
    findState,
    markSettled,
    take
  }
}

/** 把审批回执写回 agentd；`optionId === null` 表示取消本轮 */
async function postApproval(
  transport: AgentdTransport,
  threadID: string,
  requestId: string,
  optionId: string | null
): Promise<boolean> {
  try {
    const response = await transport.call(AGENTD_ROUTES.approval(threadID, requestId), {
      method: 'POST',
      body: JSON.stringify(optionId === null ? { cancelled: true } : { optionId })
    })
    return response.ok
  } catch (error) {
    console.warn('[agent-runtime/approvals] 审批回执投递失败:', error)
    return false
  }
}

/** 把追问回执写回 agentd；`action` 原样透传（accept 要带 content） */
async function postElicitation(
  transport: AgentdTransport,
  threadID: string,
  requestId: string,
  decision: CreateElicitationResponse
): Promise<boolean> {
  try {
    const response = await transport.call(AGENTD_ROUTES.elicitation(threadID, requestId), {
      method: 'POST',
      body: JSON.stringify(decision)
    })
    return response.ok
  } catch (error) {
    console.warn('[agent-runtime/approvals] 追问回执投递失败:', error)
    return false
  }
}

export { createApprovalLedger, postApproval, postElicitation }
export type { ApprovalLedger, ApprovalTakeInput, ApprovalTaken, ApprovalTicket }
