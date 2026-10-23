/**
 * ACP → 共享 chat 事件的映射表（计划 D2）。
 *
 * 这里只做**纯映射**：不碰连接、不碰 store。理由有两个 ——
 * 一是这段换算最容易被 goose 的字段变化打歪，独立出来才好写单测；
 * 二是「一次 update 产出一条事件」这条账必须能对上，混进副作用就查不清了。
 */
import type {
  ChatApprovalOption,
  ChatApprovalOptionKind,
  ChatElicitationResponse,
  ChatElicitationSchema,
  ChatMode,
  ChatPlanEntry,
  ChatSchemaField,
  ChatStreamEvent,
  ChatToolApproval
} from '@cogito/chat/ports'
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationPropertySchema,
  ElicitationSchema,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionOutcome,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate
} from '@agentclientprotocol/sdk'

/** 上下文窗口占用（`usage_update`）：这是「上下文用了多少」，**不是** token 账本 */
interface AcpContextUsage {
  used: number
  size: number
}

interface AcpStreamContext {
  /**
   * 文本 / 推理块的归组 id。
   *
   * ACP 只在「换了 messageId」时才表示新的一段，缺 `messageId` 时要由调用方按自增续写 ——
   * 这个状态不属于纯映射，故由外部注入。
   */
  blockID(messageId: string | null | undefined, kind: 'text' | 'reasoning'): string
  /** 上下文用量回调：不走事件流（它每轮都来，塞进消息里就成了一堆垃圾条目） */
  onContextUsage?(usage: AcpContextUsage): void
}

/** goose 原生 4 档权限模式（对应 `ChatMode`） */
const CHAT_MODES: readonly ChatMode[] = ['auto', 'approve', 'smart_approve', 'chat']

/** ACP 的选项类别是 snake_case，而共享层/assistant-ui 用连字符：两边都认，这里是唯一的换算点 */
const APPROVAL_KIND_MAP: Record<string, ChatApprovalOptionKind> = {
  allow_once: 'allow-once',
  allow_always: 'allow-always',
  reject_once: 'reject-once',
  reject_always: 'reject-always'
}

/** 给出「允许 / 拒绝」时，按这个顺序挑第一个可用选项 */
const ALLOW_KIND_ORDER: readonly ChatApprovalOptionKind[] = ['allow-once', 'allow-always']
const REJECT_KIND_ORDER: readonly ChatApprovalOptionKind[] = ['reject-once', 'reject-always']

function isChatMode(value: string): value is ChatMode {
  return (CHAT_MODES as readonly string[]).includes(value)
}

/** 取内容块里的纯文本：非文本块（图片 / 资源链接）不进文本流 */
function findTextBlock(content: { type: string; text?: unknown } | null | undefined): string | null {
  if (!content || content.type !== 'text') return null
  return typeof content.text === 'string' && content.text ? content.text : null
}

/**
 * 工具名。
 *
 * ACP 1.7 起 `tool_call` 有独立的 `name`（程序名），`title` 只是给人看的描述；
 * 老版本只有 `title`，所以按「`name` → `title` → 占位」回退。
 */
function findToolName(update: { name?: string | null; title?: string | null }): string {
  const name = update.name?.trim()
  if (name) return name
  const title = update.title?.trim()
  return title || 'tool'
}

/** 工具产出：`rawOutput` 是结构化结果，`content` 是展示块；两者都可能只有其一 */
function findToolOutput(update: ToolCallUpdate): unknown {
  if (update.rawOutput !== undefined && update.rawOutput !== null) return update.rawOutput
  const content = update.content
  if (!content || content.length === 0) return null
  return content
}

function parsePlanEntries(entries: readonly { content: string; status?: string; priority?: string }[]): ChatPlanEntry[] {
  return entries.map(function (entry) {
    return {
      content: entry.content,
      ...(entry.status === 'pending' || entry.status === 'in_progress' || entry.status === 'completed'
        ? { status: entry.status }
        : {}),
      ...(entry.priority === 'high' || entry.priority === 'medium' || entry.priority === 'low'
        ? { priority: entry.priority }
        : {})
    }
  })
}

function toApprovalOption(option: PermissionOption): ChatApprovalOption {
  const kind = APPROVAL_KIND_MAP[option.kind]
  return kind
    ? { id: option.optionId, kind, label: option.name }
    : // 未知类别（协议将来新增）按「拒绝一次」兜底，避免把本应拒绝的选项放大成允许
      { id: option.optionId, kind: 'reject-once', label: option.name }
}

/**
 * 回执 → ACP 结果。
 *
 * UI 可能只给「允许 / 拒绝」而不指定具体选项（例如它自己画了一对按钮），
 * 这时按类别顺序挑一个 —— 挑不出来才退回 `cancelled`，不能凭 `approved` 硬造一个 optionId。
 */
function parseAcpPermissionOutcome(
  approval: ChatToolApproval,
  options: readonly ChatApprovalOption[]
): RequestPermissionOutcome {
  if (approval.optionId) {
    const matched = options.some(function (option) {
      return option.id === approval.optionId
    })
    if (!matched) return { outcome: 'cancelled' }
    return { outcome: 'selected', optionId: approval.optionId }
  }
  const order = approval.approved ? ALLOW_KIND_ORDER : REJECT_KIND_ORDER
  // 先按 kind 建表：否则每个 kind 都要线性扫一遍 options
  const byKind = new Map<string, ChatApprovalOption>()
  for (const option of options) byKind.set(option.kind, option)
  for (const kind of order) {
    const matched = byKind.get(kind)
    if (matched) return { outcome: 'selected', optionId: matched.id }
  }
  return { outcome: 'cancelled' }
}

/** 审批请求 → `tool-approval-request` */
function parseAcpApprovalRequest(params: RequestPermissionRequest): ChatStreamEvent {
  return {
    kind: 'tool-approval-request',
    toolCallId: params.toolCall.toolCallId,
    toolName: findToolName(params.toolCall),
    input: params.toolCall.rawInput ?? null,
    ...(params.toolCall.title ? { prompt: params.toolCall.title } : {}),
    options: params.options.map(toApprovalOption)
  }
}

/** 未来类型的字段只能按 unknown 读：非字符串一律丢掉（宁可少一句说明，也别渲染出对象） */
function parseText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 追问表单字段的取值域（单选枚举在 ACP 里有 `enum` 与 `oneOf` 两种写法） */
function parseEnumValues(
  property: Extract<ElicitationPropertySchema, { type: 'string' }>
): readonly { value: string; label?: string }[] | undefined {
  if (property.enum && property.enum.length > 0) {
    return property.enum.map(function (value) {
      return { value }
    })
  }
  if (property.oneOf && property.oneOf.length > 0) {
    return property.oneOf.map(function (option) {
      return { value: option.const, label: option.title }
    })
  }
  return undefined
}

function parseSchemaField(name: string, property: ElicitationPropertySchema): ChatSchemaField {
  // 联合里的「未来类型」带索引签名（`type: string; [key: string]: unknown`），
  // 它不会被 `switch (property.type)` 排除，但每个 case 里的字段类型已经按运行时判别核对过，
  // 故这里显式收窄到具体变体（否则读出来的是 `unknown`）。
  switch (property.type) {
    case 'string': {
      const schema = property as Extract<ElicitationPropertySchema, { type: 'string' }>
      return {
        name,
        type: 'string',
        description: schema.description ?? undefined,
        default: schema.default ?? undefined,
        enumValues: parseEnumValues(schema),
        minLength: schema.minLength ?? undefined,
        maxLength: schema.maxLength ?? undefined
      }
    }
    case 'number':
    case 'integer': {
      const schema = property as Extract<ElicitationPropertySchema, { type: 'number' | 'integer' }>
      return {
        name,
        type: property.type,
        description: schema.description ?? undefined,
        default: schema.default ?? undefined,
        minimum: schema.minimum ?? undefined,
        maximum: schema.maximum ?? undefined
      }
    }
    case 'boolean': {
      const schema = property as Extract<ElicitationPropertySchema, { type: 'boolean' }>
      return {
        name,
        type: 'boolean',
        description: schema.description ?? undefined,
        default: schema.default ?? undefined
      }
    }
    default:
      // 未来类型（含 `_` 前缀的扩展）：当字符串收着，总比整张表渲染不出来强
      return { name, type: 'string', description: parseText(property.description) }
  }
}

/** 追问表单：ACP 用 JSON Schema 的一个子集描述，这里摊平成「字段数组」给 UI 直接渲染 */
function parseElicitationSchema(schema: ElicitationSchema): ChatElicitationSchema {
  const required = new Set(schema.required ?? [])
  const properties = schema.properties ?? {}
  return {
    ...(schema.title ? { title: schema.title } : {}),
    ...(schema.description ? { description: schema.description } : {}),
    fields: Object.entries(properties).map(function ([name, property]) {
      const field = parseSchemaField(name, property)
      return required.has(name) ? { ...field, required: true } : field
    })
  }
}

/**
 * 追问请求（form 模式）。
 *
 * **id 由调用方合成**：ACP 的 url 模式才带 `elicitationId`，form 模式的锚点是
 * `sessionId` +（可选）`toolCallId` —— 回执要按 id 定位，故这里只交出表单本身。
 */
function parseAcpElicitationRequest(request: CreateElicitationRequest): {
  schema: ChatElicitationSchema
  prompt?: string
} | null {
  if (request.mode !== 'form') return null
  // 同样地：联合里的「未来模式」让 `mode` 收不紧，故按运行时判别显式收窄
  const form = request as Extract<CreateElicitationRequest, { mode: 'form' }>
  return {
    schema: parseElicitationSchema(form.requestedSchema),
    ...(form.requestedSchema.title ? { prompt: form.requestedSchema.title } : {})
  }
}

/** 追问回执 → ACP 结果（`cancel` 与 `decline` 都表示「不填」） */
function parseAcpElicitationResponse(response: ChatElicitationResponse): CreateElicitationResponse {
  if (response.action === 'cancel') return { action: 'cancel' }
  return { action: 'accept', content: response.content ?? {} }
}

/**
 * `session/update` → 事件。
 *
 * 表里只列**会产出事件**的种类：其余（`user_message_chunk` —— 本地已回显、
 * `session_info_update`、`config_option_update`、`notice`、压缩与子 agent 的私有扩展等）
 * 一律走默认的 `null`，而不是在表里堆一串空实现。
 */
const STREAM_MAPPER: Partial<{
  [K in SessionUpdate['sessionUpdate']]: (
    update: Extract<SessionUpdate, { sessionUpdate: K }>,
    context: AcpStreamContext
  ) => ChatStreamEvent | null
}> = {
  agent_message_chunk(update, context) {
    const text = findTextBlock(update.content)
    return text === null ? null : { kind: 'text', blockID: context.blockID(update.messageId, 'text'), text }
  },

  agent_thought_chunk(update, context) {
    const text = findTextBlock(update.content)
    return text === null
      ? null
      : { kind: 'reasoning', blockID: context.blockID(update.messageId, 'reasoning'), text }
  },

  tool_call(update: ToolCall) {
    return {
      kind: 'tool-call',
      toolCallId: update.toolCallId,
      toolName: findToolName(update),
      input: update.rawInput ?? null
    }
  },

  tool_call_update(update) {
    // 只有走到终态才算一次结果；中间态的进度更新不进事件流（卡片自己按 tool-call 展示）
    if (update.status !== 'completed' && update.status !== 'failed') return null
    return {
      kind: 'tool-result',
      toolCallId: update.toolCallId,
      toolName: findToolName(update),
      output: findToolOutput(update),
      isError: update.status === 'failed'
    }
  },

  plan(update) {
    return { kind: 'plan', entries: parsePlanEntries(update.entries) }
  },

  available_commands_update(update) {
    return {
      kind: 'commands-update',
      commands: update.availableCommands.map(function (command) {
        return { name: command.name, description: command.description }
      })
    }
  },

  current_mode_update(update) {
    // 认不出的模式就**不要**报：报错一个档位比不报更糟（用户会以为自己选的是别的）
    const mode = update.currentModeId
    return isChatMode(mode) ? { kind: 'mode-update', mode } : null
  },

  usage_update(update, context) {
    context.onContextUsage?.({ used: update.used, size: update.size })
    return null
  }
}

function parseAcpStreamEvent(update: SessionUpdate, context: AcpStreamContext): ChatStreamEvent | null {
  const mapper = STREAM_MAPPER[update.sessionUpdate]
  if (!mapper) return null
  // 判别式在运行时已核对过：表的键就是 `sessionUpdate` 的取值，但 TS 无法从字串索引
  // 反推出对应的成员类型，故这里一次性收拢这个 cast（表项自身的参数类型是查得出的）。
  return (mapper as (update: SessionUpdate, context: AcpStreamContext) => ChatStreamEvent | null)(
    update,
    context
  )
}

export {
  parseAcpApprovalRequest,
  parseAcpElicitationRequest,
  parseAcpElicitationResponse,
  parseAcpPermissionOutcome,
  parseAcpStreamEvent
}
export type { AcpContextUsage, AcpStreamContext }
