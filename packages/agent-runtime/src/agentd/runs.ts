/**
 * agentd 会话事件流的**协议层**：路径、帧判别、游标规则。
 *
 * 这里刻意只做无状态的事 —— 解析与游标，不发起请求、不重试、不管超时。
 * 「一轮运行怎么组织」在两端是不同的（client 有后台续跑与注入队列，扩展更薄），
 * 但下面三件事必须只有一份实现，否则一定会出现「client 正常、扩展叠字」这种分裂：
 *
 * 1. 帧信封：`event: run` 的 `{ seq, kind, payload }` 与 `event: sync` 的 `{ lastSeq }`；
 * 2. `sync` 的语义：它报的是**服务端已经写到这条连接上**的位置，是权威游标；
 * 3. 去重：补发与实时尾部会重叠，同一条 `seq` 只能应用一次。
 *
 * 第 2 条尤其反直觉：agentd 重启后 `seq` 从 0 重新开始，而本地游标还是上一个进程的
 * 大数字。不回退的话，新一轮的每一条事件（含 `status/settled`）都会被当成重放旧帧丢掉，
 * 界面就卡在「思考中」直到空闲超时。
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk'

import type { SseFrame } from './sse'

/** 会话相关路径（`{baseUrl}` 之后的部分） */
function threadPath(threadID: string): string {
  return `/threads/${encodeURIComponent(threadID)}`
}

const AGENTD_ROUTES = {
  threads: '/threads',
  thread: threadPath,
  runs(threadID: string): string {
    return `${threadPath(threadID)}/runs`
  },
  events(threadID: string, after: number): string {
    return `${threadPath(threadID)}/events?after=${after}`
  },
  cancel(threadID: string): string {
    return `${threadPath(threadID)}/cancel`
  },
  state(threadID: string): string {
    return `${threadPath(threadID)}/state`
  },
  approval(threadID: string, requestId: string): string {
    return `${threadPath(threadID)}/approvals/${encodeURIComponent(requestId)}`
  },
  elicitation(threadID: string, requestId: string): string {
    return `${threadPath(threadID)}/elicitations/${encodeURIComponent(requestId)}`
  },
  gooseInvoke: '/goose/invoke'
} as const

/** agentd 发来的审批票据（`kind:'approval'` 的 payload） */
interface AgentdApprovalOption {
  optionId: string
  name: string
  kind: string
}

interface AgentdApprovalTicket {
  requestId: string
  threadID: string
  sessionId: string
  toolCall: unknown
  options: AgentdApprovalOption[]
}

interface AgentdApprovalPayload {
  approval: AgentdApprovalTicket
  type?: string
  optionId?: string | null
}

/** agentd 发来的结构化追问票据（`kind:'elicitation'` 的 payload） */
interface AgentdElicitationPayload {
  elicitation: {
    requestId: string
    sessionId: string
    mode?: string
    message?: string
    requestedSchema: unknown
  }
}

/** 一轮的终态通知（`kind:'status'` 的 payload） */
interface AgentdStatusPayload {
  phase?: string
  status?: string
  message?: string
  /** agentd 的失败归因（模型/网关、工具、授权、连接），用来决定提示去哪看 */
  errorKind?: unknown
}

/**
 * 帧的判别结果。
 *
 * `seq` 只在 `run` 帧上出现；`sync` 没有 seq，`ignored` 表示这帧与运行无关
 * （心跳、未知事件类型、别的连接的事件）。
 */
type AgentdRunFrame =
  | { kind: 'sync'; lastSeq: number | null }
  | { kind: 'update'; seq: number | null; update: SessionUpdate }
  | { kind: 'approval'; seq: number | null; payload: AgentdApprovalPayload }
  | { kind: 'elicitation'; seq: number | null; payload: AgentdElicitationPayload }
  | { kind: 'status'; seq: number | null; payload: AgentdStatusPayload }
  | { kind: 'ignored' }

/** 未来新增的 `kind` 一律按 `ignored` 处理，而不是抛错：旧客户端不该被新服务端打挂 */
function parseRunFrame(frame: SseFrame): AgentdRunFrame {
  if (frame.event === 'sync') {
    const lastSeq = frame.data.lastSeq
    return { kind: 'sync', lastSeq: typeof lastSeq === 'number' ? lastSeq : null }
  }
  if (frame.event !== 'run') return { kind: 'ignored' }

  const seq = typeof frame.data.seq === 'number' ? frame.data.seq : null
  const payload = (frame.data.payload ?? {}) as Record<string, unknown>

  switch (frame.data.kind) {
    case 'update':
      return { kind: 'update', seq, update: payload as unknown as SessionUpdate }
    case 'approval':
      return { kind: 'approval', seq, payload: payload as unknown as AgentdApprovalPayload }
    case 'elicitation':
      return { kind: 'elicitation', seq, payload: payload as unknown as AgentdElicitationPayload }
    case 'status':
      return { kind: 'status', seq, payload: payload as unknown as AgentdStatusPayload }
    default:
      return { kind: 'ignored' }
  }
}

interface RunCursor {
  /** 已应用的最大 seq */
  read: () => number
  /**
   * 应用 `sync` 帧：服务端权威游标，**允许回退**（agentd 重启后 seq 从 0 重来）。
   * 返回写入后的游标。
   */
  reset: (lastSeq: number) => number
  /** 只有严格大于已应用位置才返回 true —— 补发与实时尾部会重叠 */
  accept: (seq: number) => boolean
}

function createRunCursor(initial: number): RunCursor {
  let applied = initial
  return {
    read: function () {
      return applied
    },
    reset: function (lastSeq: number) {
      applied = lastSeq
      return applied
    },
    accept: function (seq: number) {
      if (seq <= applied) return false
      applied = seq
      return true
    }
  }
}

export { AGENTD_ROUTES, createRunCursor, parseRunFrame, threadPath }
export type {
  AgentdApprovalOption,
  AgentdApprovalPayload,
  AgentdApprovalTicket,
  AgentdElicitationPayload,
  AgentdRunFrame,
  AgentdStatusPayload,
  RunCursor
}
