import { randomUUID } from 'node:crypto'

import { desc, eq, gte, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { chatMessage, chatProvider, chatSession, chatUsage } from '@schema'
import { normalizeModelEntries } from '@cogito/agent/provider'
import type { ProviderSource } from '@cogito/agent/provider'
import type { CHANNELS } from '@/shared/ipc/channels'
import { IpcError } from '@/shared/ipc/error'
import { type In, type Out } from '@/shared/ipc/specs'
import { findClient } from './database'
import { resolveWorkspaceID } from './workspace'

/**
 * Chat 域：会话 / 消息 / provider / 用量账本的仓储 IPC。
 *
 * 消息的 `format` + `content` 由渲染进程的 MessageFormatAdapter 产出（见 drizzle/schema/chat.ts），
 * 主进程只做存取与顺序保证，不解析内容；因此这里没有"消息结构"类型的耦合。
 */

type ProviderReadR = Out<typeof CHANNELS.CHAT.PROVIDER.READ>[number]
type ProviderWriteP = In<typeof CHANNELS.CHAT.PROVIDER.WRITE>
type ProviderUpdateP = In<typeof CHANNELS.CHAT.PROVIDER.UPDATE>
type SessionReadR = Out<typeof CHANNELS.CHAT.SESSION.READ>[number]
type SessionWriteP = In<typeof CHANNELS.CHAT.SESSION.WRITE>
type SessionUpdateP = In<typeof CHANNELS.CHAT.SESSION.UPDATE>
type MessageReadR = Out<typeof CHANNELS.CHAT.MESSAGE.READ>[number]
type MessageReadP = In<typeof CHANNELS.CHAT.MESSAGE.READ>
type MessageAppendP = In<typeof CHANNELS.CHAT.MESSAGE.APPEND>
type MessageUpdateP = In<typeof CHANNELS.CHAT.MESSAGE.UPDATE>
type RemoveP = In<typeof CHANNELS.CHAT.PROVIDER.REMOVE>
type SessionRemoveP = In<typeof CHANNELS.CHAT.SESSION.REMOVE>
type MessageRemoveP = In<typeof CHANNELS.CHAT.MESSAGE.REMOVE>
type UsageReadP = In<typeof CHANNELS.CHAT.USAGE.READ>
type UsageReadR = Out<typeof CHANNELS.CHAT.USAGE.READ>
type UsageSummary = UsageReadR['session']
type ModelEntry = ProviderReadR['models'] extends (infer T)[] | null ? T : never

/**
 * 账本条目（`id` / `createdAt` 由仓储补）。
 *
 * 由引擎在终态汇聚点构造（见 `opencode/engine.ts` 的 `settle`），仓储只负责落库。
 */
interface ChatUsageRecord {
  /** 渲染进程为这次运行生成的 uuid；唯一约束靠它做幂等 */
  runID: string
  /** studio 会话（线程）id；未知时为 null，仍计入今日合计 */
  sessionID: string | null
  providerID: string
  model: string
  source: ProviderSource
  outcome: 'finish' | 'aborted' | 'error'
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

const EMPTY_USAGE: UsageSummary = {
  runs: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0
}

/** 「今日」的起点：**本地零点**（用户看的是本地日历日，不是 UTC 日） */
function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** 按范围聚合一笔小计；`where` 由调用点给（本会话 / 今日） */
async function sumUsage(where: SQL): Promise<UsageSummary> {
  const rows = await findClient()
    .select({
      runs: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${chatUsage.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${chatUsage.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${chatUsage.totalTokens}), 0)`
    })
    .from(chatUsage)
    .where(where)
  const row = rows[0]
  return row ? { ...row, runs: Number(row.runs) } : EMPTY_USAGE
}

/**
 * `models` 在 API 侧是数组、落库是 JSON 文本。
 *
 * 归一交给 `@cogito/agent/provider` 的 `normalizeModelEntries`：它同时吃掉
 * 早期只存模型名的 `string[]` 与新写的对象数组，所以老库不用迁移。
 */
function parseModels(value: string | null): ModelEntry[] | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? normalizeModelEntries(parsed) : null
  } catch (error) {
    console.warn('[chat] provider.models 不是合法 JSON，按未配置处理', error)
    return null
  }
}

/** `models` 数组序列化为 JSON 文本；空数组与 null 都按"未配置额外模型"落 null */
function stringifyModels(models: ModelEntry[] | null | undefined): string | null {
  return models && models.length > 0 ? JSON.stringify(models) : null
}

function toProvider(row: {
  id: string
  kind: string
  name: string
  baseUrl: string | null
  models: string | null
  model: string | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}): ProviderReadR {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    baseUrl: row.baseUrl,
    models: parseModels(row.models),
    model: row.model,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

function toSession(row: {
  id: string
  title: string
  pinned: boolean
  providerID: string | null
  workspaceID: string | null
  createdAt: Date
  updatedAt: Date
}): SessionReadR {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    providerID: row.providerID,
    workspaceID: row.workspaceID,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

function toMessage(row: {
  id: string
  sessionID: string
  parentID: string | null
  format: string
  content: string
  createdAt: Date
  updatedAt: Date
}): MessageReadR {
  return {
    id: row.id,
    sessionID: row.sessionID,
    parentID: row.parentID,
    format: row.format,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

/**
 * 追加失败时补上「谁不在库」：外键失败是最难查的一类 —— 渲染进程手里的会话 id
 * 可能是本地映射 id，或父消息那条写入早就被丢了。查两条存在性，代价只落在失败路径上。
 */
async function describeAppendFailure(input: MessageAppendP, error: unknown): Promise<string> {
  const cause = error instanceof Error ? error.message : String(error)
  try {
    const client = findClient()
    const [session] = await client
      .select({ id: chatSession.id })
      .from(chatSession)
      .where(eq(chatSession.id, input.sessionID))
      .limit(1)

    let parent = 'null'
    if (input.parentID) {
      const [row] = await client
        .select({ id: chatMessage.id, sessionID: chatMessage.sessionID })
        .from(chatMessage)
        .where(eq(chatMessage.id, input.parentID))
        .limit(1)
      parent = `${input.parentID}（${row ? `在库，属于 ${row.sessionID}` : '不在库'}）`
    }

    let self = ''
    if (input.id) {
      const [row] = await client
        .select({ id: chatMessage.id })
        .from(chatMessage)
        .where(eq(chatMessage.id, input.id))
        .limit(1)
      self = `，本条 id=${input.id}（${row ? '已在库' : '不在库'}）`
    }

    return `消息落库失败: ${cause}；sessionID=${input.sessionID}（${session ? '在库' : '不在库'}），parentID=${parent}${self}`
  } catch (failure) {
    // 诊断本身失败不能盖掉原始错误
    console.warn('[chat] 追加失败诊断未取到在场性信息', failure)
    return `消息落库失败: ${cause}；sessionID=${input.sessionID}，parentID=${input.parentID ?? 'null'}`
  }
}

/**
 * 消息的父节点**必须**落在同一会话里：`chatMessage.parentID` 是自引用外键，父不在库就整条写不进去，
 * 而且失败会顺着父链传染（后面每条都以"不存在的父"为父）。渲染进程在切会话的一瞬间可能还带着
 * 上一条会话的父 id，所以这里宁可修一条：父不在本会话就挂到本会话最新一条（时间上它确实是后一条），
 * 没有父可用时才当新的根。
 */
async function repairParentID(
  sessionID: string,
  parentID: string | null | undefined
): Promise<string | null> {
  if (!parentID) return null
  const client = findClient()
  const [parent] = await client
    .select({ id: chatMessage.id, sessionID: chatMessage.sessionID })
    .from(chatMessage)
    .where(eq(chatMessage.id, parentID))
    .limit(1)
  if (parent && parent.sessionID === sessionID) return parentID

  const [head] = await client
    .select({ id: chatMessage.id })
    .from(chatMessage)
    .where(eq(chatMessage.sessionID, sessionID))
    // createdAt 只到毫秒，连着追加会打平；写入顺序（rowid）才是「最后一条」
    .orderBy(desc(sql`rowid`))
    .limit(1)
  const repaired = head?.id ?? null
  console.warn('[chat] 父消息不在本会话，已改挂到本会话最新一条', {
    sessionID,
    parentID,
    repaired
  })
  return repaired
}

/**
 * 会话行**必须**在消息之前存在：`chatMessage.sessionID` 是外键。会话 id 本来就是客户端生成的
 * （渲染进程 `initialize()` 落库后拿到），补建一行是幂等的，且比丢消息好得多 ——
 * 丢了消息的表现就是「聊过、界面上有、点开却是空的」。
 */
async function ensureSessionRow(sessionID: string, now: Date): Promise<void> {
  const client = findClient()
  const existing = await client
    .select({ id: chatSession.id })
    .from(chatSession)
    .where(eq(chatSession.id, sessionID))
    .limit(1)
  if (existing.length > 0) return

  console.warn('[chat] 会话行不在库，按消息带来的 id 补建（标题先用默认名）', sessionID)
  await client
    .insert(chatSession)
    .values({
      id: sessionID,
      title: '新会话',
      workspaceID: await resolveWorkspaceID(),
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoNothing({ target: chatSession.id })
}

/** provider 写库值；`models` 数组序列化为 JSON 文本 */
function toProviderValues(input: ProviderWriteP) {
  return {
    kind: input.kind,
    name: input.name,
    baseUrl: input.baseUrl ? input.baseUrl : null,
    models: stringifyModels(input.models),
    model: input.model ?? null,
    enabled: input.enabled ?? true
  }
}

class Repository {
  async findProviders(): Promise<ProviderReadR[]> {
    const rows = await findClient().select().from(chatProvider).orderBy(chatProvider.name)
    return rows.map(toProvider)
  }

  async findProvider(id: string): Promise<ProviderReadR | null> {
    const rows = await findClient()
      .select()
      .from(chatProvider)
      .where(eq(chatProvider.id, id))
      .limit(1)
    return rows.length === 0 ? null : toProvider(rows[0])
  }

  /**
   * 写一行 provider：`id` 省略时新建，给出时按该 id upsert（内置的平台网关行用固定 id）。
   * upsert 的 `set` 不含 `createdAt` —— 首次落库的时间不该被后续同步改写。
   */
  async writeProvider(input: ProviderWriteP): Promise<ProviderReadR> {
    const now = new Date()
    const rows = await findClient()
      .insert(chatProvider)
      .values({
        id: input.id ?? randomUUID(),
        ...toProviderValues(input),
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: chatProvider.id,
        set: { ...toProviderValues(input), updatedAt: now }
      })
      .returning()
    return toProvider(rows[0])
  }

  async updateProvider(input: ProviderUpdateP): Promise<ProviderReadR> {
    const rows = await findClient()
      .update(chatProvider)
      .set({
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl ? input.baseUrl : null } : {}),
        ...(input.models !== undefined ? { models: stringifyModels(input.models) } : {}),
        ...(input.model !== undefined ? { model: input.model ?? null } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date()
      })
      .where(eq(chatProvider.id, input.id))
      .returning()
    if (rows.length === 0)
      throw new IpcError('CHAT_PROVIDER_NOT_FOUND', `provider 不存在: ${input.id}`)
    return toProvider(rows[0])
  }

  /** 会话的 default provider 引用为 set null，故删 provider 不会连带删会话 */
  async removeProvider(input: RemoveP): Promise<void> {
    const rows = await findClient()
      .delete(chatProvider)
      .where(eq(chatProvider.id, input.id))
      .returning()
    if (rows.length === 0)
      throw new IpcError('CHAT_PROVIDER_NOT_FOUND', `provider 不存在: ${input.id}`)
  }

  /** 置顶优先，其次最近更新 */
  async findSessions(): Promise<SessionReadR[]> {
    const rows = await findClient()
      .select()
      .from(chatSession)
      .orderBy(desc(chatSession.pinned), desc(chatSession.updatedAt))
    return rows.map(toSession)
  }

  /**
   * 建会话：`workspaceID` 走权威解析（渲染进程送来的可能是水合前的 null 或悬空 id，
   * 见 `resolveWorkspaceID`），否则会话会落到「未关联工作区」里，用户找不到自己刚建的会话。
   */
  async writeSession(input: SessionWriteP): Promise<SessionReadR> {
    const now = new Date()
    const rows = await findClient()
      .insert(chatSession)
      .values({
        id: randomUUID(),
        title: input.title ?? '新会话',
        providerID: input.providerID ?? null,
        workspaceID: await resolveWorkspaceID(input.workspaceID),
        createdAt: now,
        updatedAt: now
      })
      .returning()
    return toSession(rows[0])
  }

  async updateSession(input: SessionUpdateP): Promise<SessionReadR> {
    const workspaceID =
      input.workspaceID === undefined ? undefined : await resolveWorkspaceID(input.workspaceID)
    const rows = await findClient()
      .update(chatSession)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.providerID !== undefined ? { providerID: input.providerID ?? null } : {}),
        ...(workspaceID === undefined ? {} : { workspaceID }),
        updatedAt: new Date()
      })
      .where(eq(chatSession.id, input.id))
      .returning()
    if (rows.length === 0)
      throw new IpcError('CHAT_SESSION_NOT_FOUND', `session 不存在: ${input.id}`)
    return toSession(rows[0])
  }

  async removeSession(input: SessionRemoveP): Promise<void> {
    const rows = await findClient()
      .delete(chatSession)
      .where(eq(chatSession.id, input.id))
      .returning()
    if (rows.length === 0)
      throw new IpcError('CHAT_SESSION_NOT_FOUND', `session 不存在: ${input.id}`)
  }

  /** 按时间升序返回整条会话（分支关系由 parentID 表达） */
  async findMessages(input: MessageReadP): Promise<MessageReadR[]> {
    const rows = await findClient()
      .select()
      .from(chatMessage)
      .where(eq(chatMessage.sessionID, input.sessionID))
      .orderBy(chatMessage.createdAt)
    return rows.map(toMessage)
  }

  /**
   * 追加一条消息并顺带推进会话的 updatedAt（会话列表按最近活动排序）。
   *
   * 写之前先把两条外键前提补齐（会话行、本会话内的父节点，见 `ensureSessionRow` / `repairParentID`）：
   * 外键失败在这里的代价是**整条消息消失**（assistant-ui 会吞掉历史写入的失败），
   * 用户看到的就是「聊过、点开却是空的」。
   */
  async appendMessage(input: MessageAppendP): Promise<MessageReadR> {
    const now = new Date()
    const client = findClient()
    await ensureSessionRow(input.sessionID, now)
    const parentID = await repairParentID(input.sessionID, input.parentID)
    let rows: (typeof chatMessage.$inferSelect)[]
    try {
      rows = await client
        .insert(chatMessage)
        .values({
          id: input.id ?? randomUUID(),
          sessionID: input.sessionID,
          parentID,
          format: input.format,
          content: input.content,
          createdAt: now,
          updatedAt: now
        })
        .returning()
    } catch (error) {
      // 外键失败（会话或父消息不在库）时 better-sqlite3 只说一句 FOREIGN KEY constraint
      // failed，既没有 id 也没说是哪一条 —— 排查只能靠猜。把当事 id 和它们存不存在一并报出来。
      throw new IpcError('CHAT_MESSAGE_APPEND_FAILED', await describeAppendFailure(input, error))
    }
    await client
      .update(chatSession)
      .set({ updatedAt: now })
      .where(eq(chatSession.id, input.sessionID))
    return toMessage(rows[0])
  }

  async updateMessage(input: MessageUpdateP): Promise<MessageReadR> {
    const rows = await findClient()
      .update(chatMessage)
      .set({
        ...(input.format !== undefined ? { format: input.format } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        updatedAt: new Date()
      })
      .where(eq(chatMessage.id, input.id))
      .returning()
    if (rows.length === 0)
      throw new IpcError('CHAT_MESSAGE_NOT_FOUND', `message 不存在: ${input.id}`)
    return toMessage(rows[0])
  }

  /** 自引用外键为 cascade：删除一条消息会连带删除其后继分支 */
  async removeMessage(input: MessageRemoveP): Promise<void> {
    const rows = await findClient()
      .delete(chatMessage)
      .where(eq(chatMessage.id, input.id))
      .returning()
    if (rows.length === 0)
      throw new IpcError('CHAT_MESSAGE_NOT_FOUND', `message 不存在: ${input.id}`)
  }

  /**
   * 记一笔运行用量。
   *
   * **同步**：调用方（引擎的 `settle`）必须在发出终态事件之前把账落下来 —— 反过来的话，
   * 界面已经显示了用量、库里却还没有，刷新就归零，用户看到的仍然是「花了钱没计用量」。
   * 底层是 better-sqlite3（写本身就是同步的），所以这里不假装异步。
   *
   * `runID` 唯一约束让重复结算无害（同一运行多次走到终态只落一条）。
   * 记账失败**不能**往上抛：`settle` 抛出去就等于终态没发、界面永远停在「生成中」；
   * 但这属于必须出声的失败，所以打日志（曾经的静默丢弃正是用量链条断掉的根源）。
   */
  appendUsage(record: ChatUsageRecord): void {
    try {
      findClient()
        .insert(chatUsage)
        .values({ id: randomUUID(), createdAt: new Date(), ...record })
        .onConflictDoNothing({ target: chatUsage.runID })
        .run()
    } catch (error) {
      console.warn('[chat] 用量记账失败（本次运行的用量已丢）', error)
    }
  }

  /**
   * 用量聚合：本会话累计 + 今日合计。
   *
   * 两个范围一次问完：界面上它们总是一起出现，分两次 IPC 就要处理两次加载态。
   * 「今日」按**本地零点**切（用户看的是本地日历日）；`sessionID` 省略时不给会话小计。
   *
   * 口径说明：`today` 是**全部会话**的合计，含没有会话归属的（`sessionID` 为 null）那些，
   * 所以它不会等于「各会话之和」——这是有意的，账本要对得上真正花掉的量。
   */
  async findUsage(input: UsageReadP): Promise<UsageReadR> {
    const today = await sumUsage(gte(chatUsage.createdAt, startOfToday()))
    const session = input.sessionID
      ? await sumUsage(eq(chatUsage.sessionID, input.sessionID))
      : EMPTY_USAGE
    return { session, today }
  }
}

export { Repository }
export type { ChatUsageRecord }
