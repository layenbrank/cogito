import { z } from 'zod'

import type { ModelEntry } from '@cogito/agent/provider'

import { CHANNELS } from '@/shared/ipc/channels'
import type { ChannelOfDomain } from '@/shared/ipc/channels'
import type { ChannelSpec } from '@/shared/ipc/spec'

/** 合法 URL，或空字符串 / null 表示未设置 */
const NullableUrl = z.union([z.string().url(), z.literal('')]).nullish()

/**
 * provider 行的主键是文本。内置的网关行用固定 id（`platform-gateway`），
 * 不是 uuid，所以这里不能收窄成 `z.uuid()`。
 */
const ProviderID = z.string().min(1).max(64)
/**
 * 消息 id **由渲染进程的聊天 runtime 生成**（assistant-ui `generateId()` 是 7 位
 * nanoid，不是 uuid），落库时原样保留：`parentID` 指向同一会话里另一条消息的 id，
 * `update` / `remove` 也按它定位，`load` 还会把它交回 runtime。
 * 所以这里只约束「非空、有界」——收窄成 `z.uuid()` 会让整批消息写入被
 * `IPC_INVALID_PAYLOAD` 挡掉（历史一条都存不下来）。
 */
const MessageID = z.string().min(1).max(64)
/** 模型能力声明：缺项按「未知＝不支持」处理，由 `@cogito/agent/provider` 补默认 */
const ModelCapabilitiesSchema = z.object({
  tools: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  vision: z.boolean().optional()
})

/** 上下文/输出上限（token）；缺项走兜底值 */
const ModelLimitSchema = z.object({
  context: z.number().int().positive().optional(),
  output: z.number().int().positive().optional()
})

/**
 * 模型条目。契约真源在 `@cogito/agent/provider`，这里用 `z.ZodType` 标注
 * 让两边不一致时直接编译报错（而不是等运行时才发现）。
 */
const ModelEntrySchema: z.ZodType<ModelEntry> = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200).optional(),
  providerName: z.string().min(1).max(200).optional(),
  capabilities: ModelCapabilitiesSchema.optional(),
  limit: ModelLimitSchema.optional()
})

const ProviderReadSchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  baseUrl: z.string().nullable(),
  models: z.array(ModelEntrySchema).nullable(),
  model: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
})

/**
 * 写一行 provider。
 *
 * `id` 可省略（随机生成）；给出时按该 id **upsert** —— 内置的平台网关行有固定 id
 * （`platform-gateway`），渲染进程每次发送前都要保证它存在且与网关目录一致，
 * 不能靠「先读到没有就插入」这种会撞主键的读改写。
 */
const ProviderWriteSchema = z.object({
  id: ProviderID.optional(),
  kind: z.string().min(1),
  name: z.string().min(1),
  baseUrl: NullableUrl,
  models: z.array(ModelEntrySchema).nullish(),
  model: z.string().nullish(),
  enabled: z.boolean().optional()
})

/** 更新不能改 id，所以这里排除掉它，避免 `id` 既是主键又是待改字段 */
const ProviderUpdateSchema = ProviderWriteSchema.omit({ id: true })
  .partial()
  .extend({ id: ProviderID })

/** provider 删除不复用会话的 `RemoveSchema`：provider 的 id 是文本（内置行用固定 id） */
const ProviderRemoveSchema = z.object({
  id: ProviderID
})

const SessionReadSchema = z.object({
  id: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  providerID: z.string().nullable(),
  /** 归属的工作区；工作区被删则置空 */
  workspaceID: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})

const SessionWriteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  providerID: z.uuid().nullish(),
  workspaceID: z.uuid().nullish()
})

const SessionUpdateSchema = SessionWriteSchema.extend({
  id: z.uuid(),
  pinned: z.boolean().optional()
})

const MessageReadSchema = z.object({
  sessionID: z.uuid()
})

const MessageResultSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  parentID: z.string().nullable(),
  format: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})

const MessageAppendSchema = z.object({
  id: MessageID.optional(),
  sessionID: z.uuid(),
  parentID: MessageID.nullish(),
  format: z.string().min(1),
  content: z.string()
})

const MessageUpdateSchema = z.object({
  id: MessageID,
  format: z.string().min(1).optional(),
  content: z.string().optional()
})

/** 会话 id 由主进程 `randomUUID()` 生成，是 uuid */
const RemoveSchema = z.object({
  id: z.uuid()
})

/** 消息 id 来自 runtime（见 `MessageID`），与会话删除的契约分开 */
const MessageRemoveSchema = z.object({
  id: MessageID
})

/** 一次运行的用量小计（账本聚合结果） */
const UsageSummarySchema = z.object({
  /** 计入的运行次数（成功 / 取消 / 失败都算一次） */
  runs: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0)
})

/** 按会话读用量；`sessionID` 省略时只按日窗聚合（左栏/底栏在没有线程上下文时也能问今日） */
const UsageReadSchema = z.object({
  sessionID: z.uuid().nullish()
})

const UsageReadResultSchema = z.object({
  /** 该会话的累计（没给 `sessionID` 时是全 0） */
  session: UsageSummarySchema,
  /** 今日（本地零点起）全部会话合计 */
  today: UsageSummarySchema
})

export const chatSpecs = {
  [CHANNELS.CHAT.PROVIDER.READ]: { in: z.void(), out: z.array(ProviderReadSchema) },
  [CHANNELS.CHAT.PROVIDER.WRITE]: { in: ProviderWriteSchema, out: ProviderReadSchema },
  [CHANNELS.CHAT.PROVIDER.UPDATE]: { in: ProviderUpdateSchema, out: ProviderReadSchema },
  [CHANNELS.CHAT.PROVIDER.REMOVE]: { in: ProviderRemoveSchema, out: z.void() },

  [CHANNELS.CHAT.SESSION.READ]: { in: z.void(), out: z.array(SessionReadSchema) },
  [CHANNELS.CHAT.SESSION.WRITE]: { in: SessionWriteSchema, out: SessionReadSchema },
  [CHANNELS.CHAT.SESSION.UPDATE]: { in: SessionUpdateSchema, out: SessionReadSchema },
  [CHANNELS.CHAT.SESSION.REMOVE]: { in: RemoveSchema, out: z.void() },

  [CHANNELS.CHAT.MESSAGE.READ]: { in: MessageReadSchema, out: z.array(MessageResultSchema) },
  [CHANNELS.CHAT.MESSAGE.APPEND]: { in: MessageAppendSchema, out: MessageResultSchema },
  [CHANNELS.CHAT.MESSAGE.UPDATE]: { in: MessageUpdateSchema, out: MessageResultSchema },
  [CHANNELS.CHAT.MESSAGE.REMOVE]: { in: MessageRemoveSchema, out: z.void() },

  [CHANNELS.CHAT.USAGE.READ]: { in: UsageReadSchema, out: UsageReadResultSchema }
} as const satisfies Record<ChannelOfDomain<'chat'>, ChannelSpec>

export {
  ModelEntrySchema,
  ProviderWriteSchema,
  ProviderUpdateSchema,
  ProviderRemoveSchema,
  SessionWriteSchema,
  SessionUpdateSchema,
  MessageReadSchema,
  MessageAppendSchema,
  MessageUpdateSchema,
  MessageRemoveSchema,
  RemoveSchema,
  UsageReadSchema,
  UsageReadResultSchema,
  UsageSummarySchema
}
