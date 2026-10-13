/**
 * 服务端 agent 长任务委派（cogito `/api/v1/agent/tasks`）。
 *
 * 与本地 goose 对话是两条路：goose 跑的是「本地会话」；这里的任务**提交到 cogito**，
 * 由服务端的 durable 编排跑（模型调用、工具、人工审批都在服务端发生）。客户端只负责
 * 提交、轮询进度、对 `pendingApproval` 做决定、展示结果。
 *
 * 鉴权由 `utils/http.ts` 统一注入（JWT + `X-Tenant-ID` + `traceparent`），这里只写路径。
 */
import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

/** 待审批的一次工具调用（`TaskR.pendingApproval`，形状来自 cogito `orchestrations/agent.rs`） */
interface PendingApproval {
  /** 审批标识（`<taskID>:<步骤>:<第几次调用>`），决定审批端点路径里的就是它 */
  approvalID: string
  /** 第几轮请求的（人需要这个上下文才知道模型在干什么） */
  step: number
  /** 工具名（ai-worker 工具名，如 `memory_write`，无 `cogito_` 前缀） */
  tool: string
  /** 模型给的参数 JSON 字符串（原文，审批批的就是这一份） */
  arguments: string
  /** 逾期时间（epoch 毫秒），过了这个点这次调用就作废 */
  expiresAt: number
}

/** 任务台账行（`TaskR`，字段与 cogito `services/agent/schema.rs` 对齐） */
interface AgentTask {
  id: string
  tenantID: string
  /** 发起人；服务身份触发时为空 */
  userID: string | null
  /** `RUNNING` / `SUCCEEDED` / `FAILED` */
  status: string
  objective: string
  model: string
  maxSteps: number
  allowedTools: string[]
  /** 已完成的轮次 */
  steps: number
  /** 编排自报的进度（形如 `step:2/6 tools:2`） */
  progress: string | null
  /** 当前正等着人批的那一次工具调用；没有待审批时为空 */
  pendingApproval: PendingApproval | null
  /** 是否得出了结论；仅有结论的成功任务有值 */
  finished: boolean | null
  /** 编排输出快照（`AgentRunOutput`），成功后才有 */
  result: Record<string, unknown> | null
  /** 失败原因（已分类的运维文案） */
  error: string | null
  createdAt: number
  updatedAt: number
}

/** 提交任务的请求体（`TaskP`） */
interface SubmitAgentTaskParams {
  /** 任务目标，原样交给模型 */
  objective: string
  /** 轮次上限；缺省用部署配置 `agent.max_steps`，只能往小收 */
  maxSteps?: number
  /** 工具白名单；缺省用部署配置，给了必须是它的子集 */
  tools?: string[]
}

/** 审批决定（`ApprovalP`） */
interface ApprovalDecision {
  decision: 'APPROVED' | 'REJECTED'
  /** 驳回理由；批准时忽略 */
  reason?: string
}

/** 审批决定的结果（`ApprovalR`） */
interface ApprovalResult {
  taskID: string
  approvalID: string
  decision: string
  /** 这次调用是否**刚刚**落定（`false` = 同方向决定之前已提交过） */
  applied: boolean
  decidedAt: number
}

/** 编排输出快照（`AgentRunOutput`），成功任务的 `result` 就是这个形状 */
interface AgentTaskResult {
  taskID: string
  steps: number
  finished: boolean
  answer?: string
  toolCalls: number
  memoryID?: string
  approvals?: Array<{
    approvalID: string
    step: number
    tool: string
    decision: string
    reason?: string
  }>
}

function POST_AGENT_TASKS(params: SubmitAgentTaskParams) {
  return http.post<RSF<AgentTask>>('/agent/tasks', params, { env: 'thinking' }).then(HttpEnvelope)
}

function GET_AGENT_TASK(id: string, signal?: AbortSignal) {
  return http.get<RSF<AgentTask>>(`/agent/tasks/${id}`, { env: 'thinking', signal }).then(HttpEnvelope)
}

function POST_AGENT_TASK_APPROVAL(id: string, approvalID: string, decision: ApprovalDecision) {
  return http
    .post<RSF<ApprovalResult>>(`/agent/tasks/${id}/approvals/${approvalID}`, decision, {
      env: 'thinking'
    })
    .then(HttpEnvelope)
}

export { GET_AGENT_TASK, POST_AGENT_TASKS, POST_AGENT_TASK_APPROVAL }
export type {
  AgentTask,
  AgentTaskResult,
  ApprovalDecision,
  ApprovalResult,
  PendingApproval,
  SubmitAgentTaskParams
}
