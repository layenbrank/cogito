/**
 * 共享 chat 层：领域类型 + 端口接口 + assistant-ui 适配器。
 *
 * 环境无关是硬约束：本包只能依赖 React / assistant-ui，不得引入 Node、Electron、`chrome.*`。
 * 端口由 app 各自实现，当前只有 `apps/studio`：
 * - `apps/studio`：历史走主进程 IPC（Drizzle），模型走 MessagePort（agent 运行时：
 *   个人模型用自带 Key，组织模型用登录令牌，链路与工具/审批完全一致）
 * - `apps/extension`：暂未接入本包
 */

/** 会话（线程）元数据 */
interface ChatThread {
  id: string
  title: string
  pinned: boolean
  /** epoch ms */
  updatedAt: number
  providerID: string | null
  /** 归属的工作区（app 侧用它分组会话）；未绑定 / 区已删时为 null */
  workspaceID: string | null
}

/**
 * 一条消息的持久化行 —— assistant-ui 的存储契约，列名不可改名：
 * `{ id, parent_id, format, content }`（见 drizzle/schema/chat.ts）。
 * `content` 是该 `format` 对应适配器 encode 出的不透明字符串。
 */
interface ChatStoredMessage {
  id: string
  parentID: string | null
  format: string
  content: string
}

/** 历史端口：会话与消息的读写（studio / extension 各实现一份） */
interface ChatHistoryPort {
  /** 置顶优先、最近活动在前 */
  findThreads(): Promise<ChatThread[]>
  findThread(id: string): Promise<ChatThread | null>
  createThread(input?: {
    title?: string
    providerID?: string | null
    workspaceID?: string | null
  }): Promise<ChatThread>
  updateThread(
    id: string,
    patch: { title?: string; pinned?: boolean; workspaceID?: string | null }
  ): Promise<ChatThread>
  deleteThread(id: string): Promise<void>
  /** 按时间升序返回整条会话 */
  findMessages(input: { threadID: string }): Promise<ChatStoredMessage[]>
  appendMessage(input: { threadID: string } & ChatStoredMessage): Promise<void>
  updateMessage(input: { id: string; format?: string; content?: string }): Promise<void>
  /** 删除消息（含其后继分支，由实现方决定级联语义） */
  deleteMessages(input: { ids: string[] }): Promise<void>
}

/** 模型目标：由 app 注入（当前选中的 provider / 模型） */
interface ChatTarget {
  providerID: string
  model: string
}

/** 随用户消息发出的图片。data 是 data URL，共享层不解释像素 */
interface ChatImage {
  mediaType: string
  data: string
}

interface ChatRunMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /**
   * 随消息一起发出的附件/引用名单（文件名或路径）。
   * 共享层只传递标签，怎么解释（工作区相对路径 / 上传文件 id）由 app 决定。
   * 图片不放这里：图片内容在 `images`。
   */
  attachments?: readonly string[]
  /** 只有用户消息会带。模型看不看得见由 app 在发送前决定 */
  images?: readonly ChatImage[]
}

interface ChatRunInput {
  messages: ChatRunMessage[]
  /**
   * 宿主侧扩展（模型能力、审批策略、沙箱根…）。
   * 形状由各 app 自己定义与校验 —— 共享层只负责把它原样传给端口实现。
   */
  host?: Record<string, unknown>
}

interface ChatUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/** 审批选项类别：与 assistant-ui 的 `ToolApprovalOptionKind` 同义（两边都要能用） */
type ChatApprovalOptionKind = 'allow-once' | 'allow-always' | 'reject-once' | 'reject-always'

/** 一次审批能给出的决定。`id` 是宿主给的不透明标识（ACP 即 `optionId`） */
interface ChatApprovalOption {
  id: string
  kind: ChatApprovalOptionKind
  label?: string
}

/** 计划条目（ACP `plan` 更新带来的整份计划；缺省字段表示未标注） */
interface ChatPlanEntry {
  content: string
  status?: 'pending' | 'in_progress' | 'completed'
  priority?: 'high' | 'medium' | 'low'
}

/** 权限模式：goose 原生 4 档（不是 studio 的 `ask|auto|readonly`） */
type ChatMode = 'auto' | 'approve' | 'smart_approve' | 'chat'

/** 可选项名单（斜杠命令 / agent mention）：端口只传名字与说明，怎么触发由 app 定 */
interface ChatCommand {
  name: string
  description?: string
}

/** 追问表单字段：JSON Schema 的一个子集，够渲染输入控件即可 */
interface ChatSchemaField {
  name: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'enum'
  required?: boolean
  default?: unknown
  description?: string
  enumValues?: readonly { value: string; label?: string }[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
}

interface ChatElicitationSchema {
  title?: string
  description?: string
  fields: readonly ChatSchemaField[]
}

/** 追问回执（UI → 宿主）：`action: 'cancel'` 时不带 `content` */
interface ChatElicitationResponse {
  elicitationId: string
  action: 'accept' | 'cancel'
  /** `accept` 时按 `schema.fields` 填的值 */
  content?: Record<string, unknown>
}

/**
 * 模型流事件（纯数据，跨进程/跨网络都用这一套）。
 * `blockID` 用于把同一段文本（或同一段推理）的增量归组。
 */
type ChatStreamEvent =
  | { kind: 'text'; blockID: string; text: string }
  | { kind: 'reasoning'; blockID: string; text: string }
  | { kind: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | {
      kind: 'tool-approval-request'
      toolCallId: string
      toolName: string
      input: unknown
      /** 给用户看的一句话（工具自己给，缺失时由 UI 兜底） */
      prompt?: string
      /** 可选决定（ACP 的 `options`）；缺省时 UI 用允许 / 拒绝一对 */
      options?: readonly ChatApprovalOption[]
    }
  | { kind: 'plan'; entries: readonly ChatPlanEntry[] }
  | {
      /**
       * 结构化追问（ACP `elicitation/create` 的 form 模式）：UI 按 `schema` 渲染表单。
       * 与审批一样是「停下来等人」：不回答（或超时）流程不会继续。
       */
      kind: 'elicitation-request'
      elicitationId: string
      schema: ChatElicitationSchema
      prompt?: string
    }
  | { kind: 'mode-update'; mode: ChatMode }
  | { kind: 'commands-update'; commands: readonly ChatCommand[] }
  | {
      kind: 'tool-result'
      toolCallId: string
      toolName: string
      output: unknown
      isError?: boolean
    }
  | {
      /**
       * 回执没被受理：发起这次审批的那次运行已经不在等待它了。
       *
       * UI 该把这一项按失败收敛（而不是让它永远停在「待审批」），并提示用户重新发送。
       */
      kind: 'tool-approval-failed'
      toolCallId: string
      /** 给用户看的一句话（回执为什么不算数） */
      message: string
    }
  | { kind: 'finish'; finishReason: string; usage: ChatUsage }
  /**
   * 取消 / 被新一轮取代。
   *
   * **已经烧掉的 token 照样要报**：用户中途点停也在花钱，漏掉它账面上就是「花了却没计」。
   * 端口拿不到数字时省略（例如还没收到任何一步就被取消）。
   */
  | { kind: 'aborted'; usage?: ChatUsage }
  /** 失败同样带用量（重试过的步骤也花过 token）；拿不到时省略 */
  | { kind: 'error'; message: string; usage?: ChatUsage }

/** 工具审批回执（渲染进程 → 宿主）：由 UI 决定是否放行 */
interface ChatToolApproval {
  toolCallId: string
  approved: boolean
  /** 选中的具体选项（ACP 即 `optionId`）；只有多选项审批才带 */
  optionId?: string
}

/** 模型端口：一次生成的事件流（实现方必须响应 `signal` 中止） */
interface ChatModelPort {
  /** 当前选中的 provider/模型；未配置时返回 null，由适配器抛可展示的错误。异步：配置来自 IPC/Dexie */
  findTarget(): Promise<ChatTarget | null>
  run(input: ChatRunInput & ChatTarget, signal: AbortSignal): AsyncIterable<ChatStreamEvent>
  /**
   * 回答一次工具审批（事件流里出现过 `tool-approval-request`）。
   * 实现方须把它转到**发起这次审批的那次运行**；返回 `false` 表示这次审批已经不在等待中
   * （运行结束 / 工具已跑完），调用方据此如实提示用户，而不是假报成功。
   */
  respondToApproval?(input: ChatToolApproval): boolean
  /**
   * 回答一次结构化追问（事件流里出现过 `elicitation-request`）。
   * 与审批同理：返回 `false` 表示这次追问已经不在等待中，调用方据此如实提示用户。
   */
  respondToElicitation?(input: ChatElicitationResponse): boolean
}

/** 给联合类型每个成员补上字段（分发式条件类型） */
type WithRunID<T> = T extends unknown ? T & { runID: string } : never

/**
 * MessagePort 传输的请求（渲染进程 → 主进程）。
 * 只有 studio（Electron）用这套信封；extension 走 HTTPS + AI SDK 数据流，不涉及。
 */
type ChatPortRequest =
  | ({ kind: 'start'; runID: string } & ChatTarget & ChatRunInput)
  | { kind: 'abort'; runID: string }
  | ({ kind: 'tool-approval'; runID: string } & ChatToolApproval)

/**
 * MessagePort 传输的事件（主进程 → 渲染进程）：共享事件形状 + 运行 id。
 * 一个端口上可能同时跑多个运行，用 `runID` 区分。
 */
type ChatPortEvent = WithRunID<ChatStreamEvent>

export type {
  ChatApprovalOption,
  ChatApprovalOptionKind,
  ChatCommand,
  ChatElicitationResponse,
  ChatElicitationSchema,
  ChatHistoryPort,
  ChatImage,
  ChatMode,
  ChatModelPort,
  ChatPlanEntry,
  ChatPortEvent,
  ChatPortRequest,
  ChatRunInput,
  ChatRunMessage,
  ChatSchemaField,
  ChatStoredMessage,
  ChatStreamEvent,
  ChatTarget,
  ChatThread,
  ChatToolApproval,
  ChatUsage
}
