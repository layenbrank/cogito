import {
  fromThreadMessageLike,
  type MessageFormatItem,
  type MessageStorageEntry,
  type RemoteThreadListAdapter,
  type ThreadMessage
} from '@assistant-ui/react'
import { describe, expect, it, vi } from 'vitest'

import type { ChatHistoryPort, ChatModelPort, ChatStoredMessage, ChatThread } from '../ports'
import {
  createChatModelAdapter,
  ELICITATION_PART_NAME,
  PLAN_PART_NAME,
  type ChatElicitationPartData,
  type ChatPlanPartData
} from './chat-model'
import { createThreadHistoryAdapter, LOCAL_FORMAT, type ThreadIdentity } from './thread-history'
import { createThreadListAdapter } from './thread-list'

/** 内存版历史端口：按写入顺序返回消息，语义与主进程实现一致 */
class MemoryPort implements ChatHistoryPort {
  private readonly threads = new Map<string, ChatThread>()
  private readonly messages: Array<{ threadID: string } & ChatStoredMessage> = []
  private seq = 0

  async findThreads(): Promise<ChatThread[]> {
    return [...this.threads.values()]
  }

  async findThread(id: string): Promise<ChatThread | null> {
    return this.threads.get(id) ?? null
  }

  async createThread(input?: {
    title?: string
    providerID?: string | null
    workspaceID?: string | null
  }): Promise<ChatThread> {
    this.seq += 1
    const thread: ChatThread = {
      id: `thread-${this.seq}`,
      title: input?.title ?? '新会话',
      pinned: false,
      updatedAt: this.seq,
      providerID: input?.providerID ?? null,
      workspaceID: input?.workspaceID ?? null
    }
    this.threads.set(thread.id, thread)
    return thread
  }

  async updateThread(
    id: string,
    patch: { title?: string; pinned?: boolean; workspaceID?: string | null }
  ): Promise<ChatThread> {
    const thread = this.threads.get(id)
    if (!thread) throw new Error(`thread not found: ${id}`)
    const next = { ...thread, ...patch, updatedAt: thread.updatedAt + 1 }
    this.threads.set(id, next)
    return next
  }

  async deleteThread(id: string): Promise<void> {
    this.threads.delete(id)
  }

  async findMessages(input: { threadID: string }): Promise<ChatStoredMessage[]> {
    return this.messages
      .filter(function (row) {
        return row.threadID === input.threadID
      })
      .map(function (row) {
        return { id: row.id, parentID: row.parentID, format: row.format, content: row.content }
      })
  }

  async appendMessage(input: { threadID: string } & ChatStoredMessage): Promise<void> {
    this.messages.push(input)
  }

  async updateMessage(input: { id: string; format?: string; content?: string }): Promise<void> {
    const row = this.messages.find(function (item) {
      return item.id === input.id
    })
    if (!row) throw new Error(`message not found: ${input.id}`)
    if (input.content !== undefined) row.content = input.content
    if (input.format !== undefined) row.format = input.format
  }

  async deleteMessages(input: { ids: string[] }): Promise<void> {
    const doomed = new Set(input.ids)
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      if (doomed.has(this.messages[index].id)) this.messages.splice(index, 1)
    }
  }

  /** 消息落到了哪些会话（按写入顺序）：断言"写对了会话"用 */
  get appendedThreadIDs(): string[] {
    return this.messages.map(function (row) {
      return row.threadID
    })
  }
}

/** 一条已落库的历史行（`LOCAL_CODEC` 能解出来的形状） */
function toStoredRow(
  threadID: string,
  id: string,
  text: string
): { threadID: string } & ChatStoredMessage {
  return {
    threadID,
    id,
    parentID: null,
    format: LOCAL_FORMAT,
    content: JSON.stringify({
      role: 'user',
      content: [{ type: 'text', text }],
      createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString()
    })
  }
}

/** withFormat 测试用的消息形状 */
interface TestMessage {
  id: string
  text: string
}

function buildMessage(
  id: string,
  text: string,
  role: 'user' | 'assistant' = 'user'
): ThreadMessage {
  return fromThreadMessageLike({ role, content: [{ type: 'text', text }] }, id, {
    type: 'complete',
    reason: 'unknown'
  })
}

async function buildPort(): Promise<{ port: MemoryPort; threadID: string }> {
  const port = new MemoryPort()
  const thread = await port.createThread()
  return { port, threadID: thread.id }
}

/** 已落库线程的身份 */
function identityOf(threadID: string): ThreadIdentity {
  return {
    async resolve() {
      return threadID
    },
    async ensure() {
      return threadID
    }
  }
}

/**
 * 新建线程的身份假件：快照在会话落库前读不到 id（真实实现里那是 assistant-ui 的
 * 列表项状态，新建线程 promotion 期间可能还是空值），`ensure()` 才去建会话
 * —— 用它锁住「写路径必须 ensure」。
 */
function buildPendingIdentity(port: MemoryPort) {
  let remoteId: string | null = null
  const ensure = vi.fn(async function (): Promise<string> {
    if (!remoteId) remoteId = (await port.createThread()).id
    return remoteId
  })
  const identity: ThreadIdentity = {
    async resolve() {
      return remoteId
    },
    ensure
  }

  return { identity, ensure }
}

describe('createThreadHistoryAdapter', function () {
  it('append 后 load 能原样读回，并按 lastMessageAt 计算 head', async function () {
    const { port, threadID } = await buildPort()
    const adapter = createThreadHistoryAdapter(port, identityOf(threadID))

    await adapter.append({ parentId: null, message: buildMessage('m1', '你好') })
    await adapter.append({ parentId: 'm1', message: buildMessage('m2', '在的', 'assistant') })

    const repository = await adapter.load()
    expect(repository.headId).toBe('m2')
    expect(repository.messages).toHaveLength(2)
    expect(
      repository.messages.map(function (item) {
        return item.parentId
      })
    ).toEqual([null, 'm1'])
  })

  it('分支时 head 取最近的叶子（无子节点）', async function () {
    const { port, threadID } = await buildPort()
    const adapter = createThreadHistoryAdapter(port, identityOf(threadID))

    await adapter.append({ parentId: null, message: buildMessage('m1', '根') })
    await adapter.append({ parentId: 'm1', message: buildMessage('m2', '分支 A', 'assistant') })
    await adapter.append({ parentId: 'm1', message: buildMessage('m3', '分支 B', 'assistant') })
    // 两个叶子（m2 / m3）；再给 A 接一条，最新叶子变成 m4
    await adapter.append({ parentId: 'm2', message: buildMessage('m4', 'A 的后续', 'assistant') })

    const repository = await adapter.load()
    expect(repository.headId).toBe('m4')
  })

  it('跳过其它格式的行（本地与在线格式不混读）', async function () {
    const { port, threadID } = await buildPort()
    const adapter = createThreadHistoryAdapter(port, identityOf(threadID))

    await adapter.append({ parentId: null, message: buildMessage('m1', '本地') })
    await port.appendMessage({
      threadID,
      id: 'ai-1',
      parentID: null,
      format: 'ai-sdk/v6',
      content: JSON.stringify({ role: 'user', parts: [] })
    })

    const repository = await adapter.load()
    expect(repository.messages).toHaveLength(1)
    expect(repository.messages[0].message.id).toBe('m1')
    expect(LOCAL_FORMAT).toBe('ith/thread-message-like')
  })

  it('一行坏数据（JSON 被截断 / 旧形状）只跳过它，后面的消息照常读回', async function () {
    const { port, threadID } = await buildPort()
    const adapter = createThreadHistoryAdapter(port, identityOf(threadID))
    const spied = vi.spyOn(console, 'warn').mockImplementation(function () {})

    await adapter.append({ parentId: null, message: buildMessage('m1', '好') })
    await port.appendMessage({
      threadID,
      id: 'broken',
      parentID: 'm1',
      format: LOCAL_FORMAT,
      // 写一半断电留下的截断 JSON
      content: '{"role":"user","content":[{"type":"te'
    })
    await port.appendMessage({
      threadID,
      id: 'm2',
      parentID: 'broken',
      format: LOCAL_FORMAT,
      content: JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '后面这条要能看到' }],
        createdAt: new Date().toISOString()
      })
    })

    const repository = await adapter.load()
    expect(
      repository.messages.map(function (item) {
        return item.message.id
      })
    ).toEqual(['m1', 'm2'])
    expect(spied).toHaveBeenCalled()

    spied.mockRestore()
  })

  it('delete 按 id 删除；update 覆写同一条', async function () {
    const { port, threadID } = await buildPort()
    const adapter = createThreadHistoryAdapter(port, identityOf(threadID))

    await adapter.append({ parentId: null, message: buildMessage('m1', '原文') })
    await adapter.update?.({ parentId: null, message: buildMessage('m1', '改后') })
    const updated = await adapter.load()
    expect(updated.messages[0].message.content).toEqual([{ type: 'text', text: '改后' }])

    await adapter.delete?.([{ parentId: null, message: buildMessage('m1', '改后') }])
    expect((await adapter.load()).messages).toHaveLength(0)
  })

  it('持久化 metadata.custom（用量）：刷新后仍读得到，无 custom 的消息不写 metadata', async function () {
    const { port, threadID } = await buildPort()
    const adapter = createThreadHistoryAdapter(port, identityOf(threadID))

    const custom = { usage: { inputTokens: 3, totalTokens: 9 } }
    await adapter.append({
      parentId: null,
      message: fromThreadMessageLike(
        { role: 'assistant', content: [{ type: 'text', text: '好' }], metadata: { custom } },
        'm1',
        { type: 'complete', reason: 'stop' }
      )
    })
    await adapter.append({ parentId: 'm1', message: buildMessage('m2', '纯文本') })

    const rows = await port.findMessages({ threadID })
    expect(JSON.parse(rows[0].content).metadata).toEqual({ custom })
    // 没有 custom 的消息不落 metadata，别让每行都背上空对象
    expect(JSON.parse(rows[1].content)).not.toHaveProperty('metadata')

    const repository = await adapter.load()
    expect(repository.messages[0].message.metadata?.custom).toEqual(custom)
  })

  it('withFormat 用调用方的格式适配器读写同一存储', async function () {
    const { port, threadID } = await buildPort()
    const adapter = createThreadHistoryAdapter(port, identityOf(threadID))

    const formatted = adapter.withFormat?.({
      format: 'ai-sdk/v6',
      getId: function (message: TestMessage) {
        return message.id
      },
      encode: function (item: MessageFormatItem<TestMessage>) {
        return { text: item.message.text }
      },
      decode: function (stored: MessageStorageEntry<{ text: string }>) {
        return {
          parentId: stored.parent_id,
          message: { id: stored.id, text: stored.content.text }
        }
      }
    })

    expect(formatted).toBeDefined()
    await formatted?.append({ parentId: null, message: { id: 'a1', text: '在线写入' } })
    const loaded = await formatted?.load()
    expect(loaded?.messages[0].message).toEqual({ id: 'a1', text: '在线写入' })

    // 本地适配器读不到在线格式的行
    expect((await adapter.load()).messages).toHaveLength(0)
  })

  it('没有会话时读历史返回空、且不建会话（读路径不建会话）', async function () {
    const port = new MemoryPort()
    const { identity } = buildPendingIdentity(port)
    const adapter = createThreadHistoryAdapter(port, identity)

    await expect(adapter.load()).resolves.toEqual({ headId: null, messages: [] })
    expect(await port.findThreads()).toHaveLength(0)
    expect(port.appendedThreadIDs).toEqual([])
  })

  it('已有会话按权威 id 读回历史，且读路径绝不建会话', async function () {
    const { port, threadID } = await buildPort()
    await port.appendMessage(toStoredRow(threadID, 'm1', '早上好'))

    // 切会话那一刻列表项状态可能还没带上 remoteId（「点开会话一片空白」就是这条）：
    // 读路径必须走 resolve() 去拿权威 id，而不是只认那份可能还没发布的快照
    const ensure = vi.fn()
    const adapter = createThreadHistoryAdapter(port, {
      resolve: async function () {
        return threadID
      },
      ensure
    })

    expect((await adapter.load()).headId).toBe('m1')
    expect(ensure).not.toHaveBeenCalled()
  })

  it('新建线程的第一条消息：先 ensure 拿落库后的 id 再写（否则会外键失败被静默吞掉）', async function () {
    const port = new MemoryPort()
    const { identity, ensure } = buildPendingIdentity(port)
    const adapter = createThreadHistoryAdapter(port, identity)

    await adapter.append({ parentId: null, message: buildMessage('m1', '测试') })

    expect(ensure).toHaveBeenCalledTimes(1)
    expect(port.appendedThreadIDs).toEqual(['thread-1'])
    // 端口拿到的必须是真会话 id，否则主进程那条 insert 会撞外键
    expect(await port.findThread(port.appendedThreadIDs[0])).not.toBeNull()

    await adapter.append({ parentId: 'm1', message: buildMessage('m2', '好的', 'assistant') })
    const repository = await adapter.load()
    expect(repository.headId).toBe('m2')
  })

  it('update / delete 不碰会话身份（改的是已存在的消息）', async function () {
    const port = new MemoryPort()
    const { identity, ensure } = buildPendingIdentity(port)
    const adapter = createThreadHistoryAdapter(port, identity)

    await adapter.append({ parentId: null, message: buildMessage('m1', '原文') })
    expect(ensure).toHaveBeenCalledTimes(1)

    await adapter.update?.({ parentId: null, message: buildMessage('m1', '改后') })
    await adapter.delete?.([{ parentId: null, message: buildMessage('m1', '改后') }])

    expect(ensure).toHaveBeenCalledTimes(1)
  })

  it('身份解析失败要留日志再抛（assistant-ui 会静默吞掉写入失败）', async function () {
    const port = new MemoryPort()
    const spied = vi.spyOn(console, 'error').mockImplementation(function () {})
    const adapter = createThreadHistoryAdapter(port, {
      async resolve() {
        return null
      },
      async ensure() {
        throw new Error('[CHAT] 没有活动会话')
      }
    })

    await expect(
      adapter.append({
        parentId: null,
        message: fromThreadMessageLike(
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
          'm1',
          { type: 'complete', reason: 'unknown' }
        )
      })
    ).rejects.toThrow('[CHAT] 没有活动会话')
    expect(spied).toHaveBeenCalled()

    spied.mockRestore()
  })
})

describe('createChatModelAdapter', function () {
  function buildModelPort(events: Parameters<typeof Array.from>[0]): ChatModelPort {
    return {
      async findTarget() {
        return { providerID: 'p1', model: 'qwen3:8b' }
      },
      async *run() {
        for (const event of events as unknown as Array<Record<string, unknown>>) {
          yield event as never
        }
      }
    }
  }

  /**
   * 收快照：适配器每个事件后推一份累计内容，界面拿到的就是这些。
   * 断言 part 的**次序**用它 —— 次序错了界面上的时序就反了（工具调用跑到回答下方）。
   */
  async function collectSnapshots(adapter: ReturnType<typeof createChatModelAdapter>) {
    const snapshots: Array<
      readonly { type: string; text?: string; name?: string; data?: unknown }[]
    > = []
    for await (const result of (
      adapter.run as (input: never) => AsyncGenerator<{
        content?: readonly { type: string; text?: string; name?: string; data?: unknown }[]
      }>
    )({ messages: [buildMessage('m1', '你好')] } as never)) {
      if (result.content) snapshots.push(result.content)
    }
    return snapshots
  }

  function orderOf(parts: readonly { type: string }[] | undefined) {
    return parts?.map(function (part) {
      return part.type
    })
  }

  it('把增量聚合成快照，finish 时带状态与用量', async function () {
    const adapter = createChatModelAdapter(
      buildModelPort([
        { kind: 'reasoning', blockID: 'r1', text: '想想' },
        { kind: 'text', blockID: 't1', text: '你' },
        { kind: 'text', blockID: 't1', text: '好' },
        { kind: 'finish', finishReason: 'stop', usage: { totalTokens: 7 } }
      ])
    )

    const options = { messages: [buildMessage('m1', '你好')] } as never
    const snapshots: Array<readonly { type: string; text?: string }[]> = []
    for await (const result of (
      adapter.run as (input: never) => AsyncGenerator<{
        content?: readonly { type: string; text?: string }[]
        status?: { type: string }
      }>
    )(options)) {
      if (result.content) snapshots.push(result.content)
    }

    expect(snapshots[0]).toEqual([{ type: 'reasoning', text: '想想' }])
    expect(snapshots[1]).toEqual([
      { type: 'reasoning', text: '想想' },
      { type: 'text', text: '你' }
    ])
    expect(snapshots[2]).toEqual([
      { type: 'reasoning', text: '想想' },
      { type: 'text', text: '你好' }
    ])
    expect(snapshots[3]).toEqual([
      { type: 'reasoning', text: '想想' },
      { type: 'text', text: '你好' }
    ])
  })

  it('part 按事件的先后排：工具调用留在它跑的位置，正文在它之后', async function () {
    const adapter = createChatModelAdapter(
      buildModelPort([
        { kind: 'reasoning', blockID: 'r1', text: '先看目录' },
        { kind: 'text', blockID: 't1', text: '我读一下入口文件。' },
        { kind: 'tool-call', toolCallId: 'call-1', toolName: 'fs_read', input: { path: 'a.ts' } },
        { kind: 'tool-result', toolCallId: 'call-1', toolName: 'fs_read', output: 'ok' },
        { kind: 'text', blockID: 't2', text: '结论是 A。' },
        { kind: 'text', blockID: 't2', text: '要继续吗？' },
        { kind: 'finish', finishReason: 'stop', usage: { totalTokens: 9 } }
      ])
    )

    const snapshots = await collectSnapshots(adapter)

    // 工具调用一出现就落在自己的位置上（不是攒到最下方）
    expect(orderOf(snapshots[2])).toEqual(['reasoning', 'text', 'tool-call'])

    // 结果回填不重排；换 blockID 的正文另起一块，仍在工具之后
    const final = snapshots.at(-1)
    expect(orderOf(final)).toEqual(['reasoning', 'text', 'tool-call', 'text'])
    expect(final?.[2]).toMatchObject({ toolCallId: 'call-1', status: { type: 'complete' } })
    expect(final?.[3]).toEqual({ type: 'text', text: '结论是 A。要继续吗？' })
  })

  it('工具块按它**首次**出现的事件排位；失效回执不留空块', async function () {
    // 没有 tool-call 就先来了结果：块占结果那一刻的位置（仍在正文之前）
    const early = createChatModelAdapter(
      buildModelPort([
        { kind: 'tool-result', toolCallId: 'call-9', toolName: 'fs_read', output: 'ok' },
        { kind: 'text', blockID: 't1', text: '读完了' },
        { kind: 'finish', finishReason: 'stop' }
      ])
    )
    expect(orderOf((await collectSnapshots(early)).at(-1))).toEqual(['tool-call', 'text'])

    // 回执失效（这次运行的审批已经不在等待）只收敛已有卡片：没建过的就不该凭空出现
    const ghost = createChatModelAdapter(
      buildModelPort([
        { kind: 'tool-approval-failed', toolCallId: 'ghost', message: '审批已失效' },
        { kind: 'finish', finishReason: 'stop' }
      ])
    )
    expect(
      (await collectSnapshots(ghost)).every(function (parts) {
        return parts.length === 0
      })
    ).toBe(true)
  })

  it('plan 与追问走 data part：计划整份替换、追问按 id 原地更新，位置都在事件次序上', async function () {
    const adapter = createChatModelAdapter(
      buildModelPort([
        { kind: 'plan', entries: [{ content: '读入口文件' }, { content: '改配置' }] },
        { kind: 'text', blockID: 't1', text: '按计划来。' },
        { kind: 'plan', entries: [{ content: '读入口文件', status: 'completed' }] },
        { kind: 'elicitation-request', elicitationId: 'e1', schema: { title: '选目录', fields: [] } },
        {
          kind: 'elicitation-request',
          elicitationId: 'e1',
          schema: { title: '选目录', fields: [{ name: 'dir', type: 'string' }] },
          prompt: '用哪个目录？'
        },
        { kind: 'finish', finishReason: 'stop' }
      ])
    )

    const parts = (await collectSnapshots(adapter)).at(-1) ?? []

    // 位置：计划停在它首次出现处，正文在它之后，追问在最后 —— 不按类型归堆
    expect(
      parts.map(function (part) {
        return part.type
      })
    ).toEqual(['data', 'text', 'data'])
    expect(parts[0]).toMatchObject({ name: PLAN_PART_NAME })
    expect(parts[2]).toMatchObject({ name: ELICITATION_PART_NAME })

    // 计划是整份替换：只剩最新那一份，不叠两张卡
    const plan = parts[0].data as ChatPlanPartData
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]).toMatchObject({ content: '读入口文件', status: 'completed' })

    // 同一次追问重复到达原地更新（并带上 prompt）
    const elicitation = parts[2].data as ChatElicitationPartData
    expect(elicitation.prompt).toBe('用哪个目录？')
    expect(elicitation.schema.fields).toHaveLength(1)
  })

  it('模式 / 命令名单这类会话级更新不进消息内容', async function () {
    const adapter = createChatModelAdapter(
      buildModelPort([
        { kind: 'mode-update', mode: 'approve' },
        { kind: 'commands-update', commands: [{ name: 'compact', description: '压缩上下文' }] },
        { kind: 'finish', finishReason: 'stop' }
      ])
    )

    const snapshots = await collectSnapshots(adapter)

    // 只有 finish 那一份快照，而且内容是空的
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toEqual([])
  })

  it('审批选项透传给 assistant-ui，回填结果时仍留在卡上', async function () {
    const adapter = createChatModelAdapter(
      buildModelPort([
        { kind: 'tool-call', toolCallId: 'c1', toolName: 'memory_write', input: { key: 'a' } },
        {
          kind: 'tool-approval-request',
          toolCallId: 'c1',
          toolName: 'memory_write',
          input: { key: 'a' },
          prompt: '要写入长期记忆吗？',
          options: [
            { id: 'o1', kind: 'allow-once', label: '就这一次' },
            { id: 'o2', kind: 'reject-once' }
          ]
        },
        { kind: 'tool-result', toolCallId: 'c1', toolName: 'memory_write', output: 'ok' },
        { kind: 'finish', finishReason: 'stop' }
      ])
    )

    const snapshots = await collectSnapshots(adapter)

    const asked = snapshots[1][0] as {
      approval?: { prompt?: string; options?: readonly unknown[] }
    }
    expect(asked.approval?.prompt).toBe('要写入长期记忆吗？')
    expect(asked.approval?.options).toHaveLength(2)

    // 结果回来了，选项也得留着：用户看到的「批准了什么」不能消失
    const settled = snapshots[2][0] as {
      approval?: { approved?: boolean; options?: readonly unknown[] }
    }
    expect(settled.approval?.approved).toBe(true)
    expect(settled.approval?.options).toHaveLength(2)
  })

  it('error 事件抛出可展示错误，aborted 交出终态快照', async function () {
    const failing = createChatModelAdapter(
      buildModelPort([{ kind: 'error', message: '连接被拒绝' }])
    )
    await expect(
      (async function () {
        for await (const _result of (failing.run as (input: never) => AsyncGenerator<unknown>)({
          messages: [buildMessage('m1', '你好')]
        } as never)) {
          // 消费到抛错为止
        }
      })()
    ).rejects.toThrow('连接被拒绝')

    // 取消不是错误，但这一轮**已经用掉的 token**要随终态快照交出来（真正的账在主进程的账本里）
    const aborted = createChatModelAdapter(
      buildModelPort([{ kind: 'aborted', usage: { totalTokens: 5 } }])
    )
    const results: Array<{ status?: unknown; metadata?: unknown }> = []
    for await (const result of (aborted.run as (input: never) => AsyncGenerator<never>)({
      messages: [buildMessage('m1', '你好')]
    } as never)) {
      results.push(result as { status?: unknown; metadata?: unknown })
    }
    expect(results).toHaveLength(1)
    expect(results[0].status).toEqual({ type: 'incomplete', reason: 'cancelled' })
    expect(results[0].metadata).toMatchObject({ custom: { usage: { totalTokens: 5 } } })
  })

  it('未配置 provider / 没有可用文本时报错', async function () {
    const noTarget = createChatModelAdapter({
      findTarget: async function () {
        return null
      },
      run: async function* () {
        yield { kind: 'aborted' } as never
      }
    })

    await expect(
      (async function () {
        for await (const _result of (noTarget.run as (input: never) => AsyncGenerator<unknown>)({
          messages: []
        } as never)) {
          // 不应该有任何事件
        }
      })()
    ).rejects.toThrow('没有可用的模型')

    const noText = createChatModelAdapter({
      findTarget: async function () {
        return { providerID: 'p1', model: 'qwen3:8b' }
      },
      run: async function* () {
        yield { kind: 'aborted' } as never
      }
    })
    await expect(
      (async function () {
        for await (const _result of (noText.run as (input: never) => AsyncGenerator<unknown>)({
          messages: []
        } as never)) {
          // 不应该有任何事件
        }
      })()
    ).rejects.toThrow('没有可发送的消息')
  })
})

/** 取可选实现的 `updateCustom`：缺了就是缺陷，不该让断言静默跳过 */
function requireUpdateCustom(adapter: RemoteThreadListAdapter) {
  const updateCustom = adapter.updateCustom
  if (!updateCustom) throw new Error('thread-list 适配器必须实现 updateCustom')
  return updateCustom
}

describe('createThreadListAdapter', function () {
  it('list / initialize / rename / delete / fetch', async function () {
    const port = new MemoryPort()
    const adapter = createThreadListAdapter(port)

    const created = await adapter.initialize('local-1')
    await adapter.rename(created.remoteId, '改名后')
    const fetched = await adapter.fetch(created.remoteId)
    expect(fetched.title).toBe('改名后')
    expect(fetched.status).toBe('regular')

    const listed = await adapter.list()
    expect(
      listed.threads.map(function (thread) {
        return thread.remoteId
      })
    ).toEqual([created.remoteId])

    await adapter.delete(created.remoteId)
    expect((await adapter.list()).threads).toHaveLength(0)
  })

  it('updateCustom 只写 workspaceID：把归属落库，别的键不碰', async function () {
    const port = new MemoryPort()
    const adapter = createThreadListAdapter(port)
    const created = await adapter.initialize('local-1')
    // 契约里 `updateCustom` 是可选的（缺了它库只会报「不支持更新 custom 元数据」）
    const updateCustom = requireUpdateCustom(adapter)

    await updateCustom(created.remoteId, { workspaceID: 'ws-a', pinned: true })
    expect((await adapter.fetch(created.remoteId)).custom).toEqual({
      pinned: false,
      workspaceID: 'ws-a'
    })

    // 键缺席 = 调用方只想改别的键：不该把已有的归属误清成 null
    await updateCustom(created.remoteId, { pinned: true })
    expect((await adapter.fetch(created.remoteId)).custom?.workspaceID).toBe('ws-a')

    // 明确的 null 才是「解除归属」
    await updateCustom(created.remoteId, { workspaceID: null })
    expect((await adapter.fetch(created.remoteId)).custom?.workspaceID).toBeNull()
  })

  it('fetch 不存在的会话抛错；归档明确不支持', async function () {
    const adapter = createThreadListAdapter(new MemoryPort())

    await expect(adapter.fetch('missing')).rejects.toThrow('[CHAT] 会话不存在')
    await expect(adapter.archive('missing')).rejects.toThrow('[CHAT] 暂不支持归档')
    await expect(adapter.unarchive('missing')).rejects.toThrow('[CHAT] 暂不支持归档')
  })
})
