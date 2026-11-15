/**
 * agentd 与前端共享的编排契约（**纯类型，零运行时依赖**）。
 *
 * 刻意不 import `@langchain/langgraph`：图状态在 agentd 内部用 Annotation 声明，
 * 这里只描述「跨进程/跨语言边界上真的会出现的东西」。
 * 服务端已有的 HTTP 契约（`apps/service/spec/openapi.json`）不在此重复定义。
 */

/** 线程身份映射：客户端 SQLite 的会话 id ↔ ACP 会话 → LangGraph thread。 */
interface ThreadIdentity {
  /** 客户端 `agent_session.id`，也是 assistant-ui 的 `remoteId` */
  threadID: string
  /** goose ACP 会话 id（`session/new` 或 `session/load` 得到） */
  acpSessionID: string
  /** LangGraph thread id，agentd 内部生成 */
  graphThreadID: string
  /** 当前/最近一次 run；无 run 时为 null */
  runID: string | null
}

/** goose 会话权限档，与 `goose acp` `session/new` 返回的 `modes` 对齐（含 `chat`） */
type SessionMode = 'chat' | 'auto' | 'approve' | 'smart_approve'

/** 一次 run 的入参 */
interface GooseRunInput {
  threadID: string
  /** 工作区绝对路径（`session/new` 的 `cwd`） */
  cwd: string
  /** 用户这一轮的消息（纯文本，附件由客户端先转成 part） */
  prompt: string
  mode: SessionMode
  /** 附加系统提示（场景 playbook / 项目约定），由客户端在 run 起点注入 */
  systemPrompt?: string
}

/** run 的终态与中间态 */
type GooseRunStatus =
  | 'queued'
  | 'running'
  | 'interrupted'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** 一次 run 的结果（agentd 侧产出，前端只读） */
interface GooseRunResult {
  runID: string
  threadID: string
  status: GooseRunStatus
  /** goose 的退出码（若 run 走到进程级失败） */
  exitCode?: number | null
  /** 图停在哪个节点（对应 LangGraph `state.next`） */
  stoppedAt?: string[]
  /** 人类可读的失败原因（取消 ≠ 失败，见客户端 `acp/run-error.ts` 的口径） */
  error?: string
}

/** 需要人介入的动作（映射自 ACP `session/request_permission` / `elicitation/create`） */
interface HumanGatePayload {
  /** LangGraph interrupt id（resume 时回传） */
  interruptID: string
  kind: 'permission' | 'elicitation'
  /** ACP 的 toolCallId；elicitation 没有 id 时由 agentd 合成 */
  toolCallID?: string
  toolName?: string
  /** 与 `@cogito/agent-protocol/policy` 的 `ToolRisk` 一致 */
  risk: 'read' | 'write' | 'guarded'
  /** 供 UI 渲染的一句话说明（中文） */
  summary: string
  /** 参数摘要（已截断，不放大文件内容） */
  argumentsPreview?: string
}

/** 跨进程事件：前端 port 层把它翻成 `ChatStreamEvent` */
type OrchestrationEvent =
  | { type: 'run.started'; runID: string; threadID: string; acpSessionID: string }
  | { type: 'message.delta'; runID: string; text: string }
  | { type: 'thought.delta'; runID: string; text: string }
  | { type: 'tool.call'; runID: string; toolCallID: string; toolName: string; argumentsPreview?: string }
  | { type: 'tool.result'; runID: string; toolCallID: string; ok: boolean; summary?: string }
  | { type: 'plan'; runID: string; entries: { text: string; done: boolean }[] }
  | { type: 'usage'; runID: string; usedTokens?: number; totalTokens?: number }
  | { type: 'interrupt'; runID: string; payload: HumanGatePayload }
  | { type: 'run.finished'; result: GooseRunResult }

export type {
  GooseRunInput,
  GooseRunResult,
  GooseRunStatus,
  HumanGatePayload,
  OrchestrationEvent,
  SessionMode,
  ThreadIdentity
}
