import path from 'node:path'

import type { ModelRef, OpenCodeClient, SessionInfo } from '@opencode/client'
import { findProviderSource } from '@cogito/agent/provider'
import type { ProviderSource } from '@cogito/agent/provider'
import Store from 'electron-store'

import { createApprovalTicket, type ApprovalTicket } from '@/host/capabilities/assistant/approval'
import type { KeyStore } from '@/host/capabilities/assistant/key'
import { resolveConnection } from '@/host/capabilities/assistant/model'
import {
  findErrorMessage,
  type Log,
  type PortEvent,
  type StartRequest,
  type TerminalPortEvent
} from '@/host/capabilities/assistant/protocol'
import type { ChatUsageRecord, Repository as ChatRepository } from '@/host/capabilities/chat'
import { findAllWorkspaceFolders, resolveWorkspaceTarget } from '@/host/capabilities/workspace'
import type { WorkspaceTarget } from '@/host/capabilities/workspace'
import { resolveInside } from '@/host/capabilities/workspace/path'
import {
  applyChain,
  applyUndo,
  EMPTY_REPORT,
  readCurrentText,
  toChangeReport,
  toFileDiff,
  toPatchText,
  toRelativePath
} from './changes'
import type { ChangeReport, FileDiff } from './changes'
import { createClient } from './client'
import { buildOpencodeConfig, toConfigSignature } from './config'
import {
  createEventMapper,
  describeOpencodeError,
  type EventMapper,
  type OpencodeEvent
} from './events'
import { OPENCODE_SESSION_STORE } from './paths'
import { toPermissionDecision, toStudioAgentId, type AgentPermissionProfile } from './permission'
import { OpencodeServerManager } from './server'
import {
  planPrompt,
  SessionStore,
  toSessionTitle,
  type MappingStore,
  type SessionMapping
} from './session'

/**
 * studio 的 agent 运行时：内嵌一个 `opencode serve`，用它的 SDK 驱动。
 *
 * 为什么不在主进程自己跑循环：工具执行、上下文压缩、文件快照、子任务、MCP 这些都是
 * agent 运行时的本体，自己实现等于把一份不完整的复制品维护到底。opencode 是这份本体的
 * 现成实现，studio 只负责三件事 —— 把 provider/凭据喂给它、把事件翻译成端口协议、
 * 把审批权握在自己手里。取舍见 docs/apps/studio/online-models.md。
 *
 * 生命周期：**整个应用一个 server**（`OpencodeServerManager` 按配置签名复用/重启），
 * 会话映射持久化在 electron-store 里，所以应用重启后接着聊，opencode 那边还认得这段历史。
 *
 * v2 与 v1 的三处结构性差异，读这个文件前必须先知道（细节见 online-models.md）：
 * 1. `session.prompt` 是**入队即返回**，不再有「等它 resolve 就是跑完」这个信号；
 *    所以终态只由 `session.execution.{succeeded,failed,interrupted}` 决定，另外配三个兜底定时器；
 * 2. SDK 直接返回数据、失败即抛异常（没有 `{data, error}` 信封）；
 * 3. 只有**一条**全局事件流（`event.subscribe()` 不接受 directory）。
 */

/**
 * 一次运行的状态。
 *
 * `approvals` 的键是**工具调用 id**：渲染进程回执只带这个 id，而回执要发给
 * 「提问的那个会话」（可能是子代理会话），所以值里连 sessionID 一起记。
 */
interface RunContext {
  controller: AbortController
  approvals: Map<string, PendingApproval>
}

/** 一次待拍板的审批：票据 + 往哪儿回执 */
interface PendingApproval {
  ticket: ApprovalTicket
  /** 提问的会话（子代理自己起的会话也会来问，回执必须发回它） */
  sessionID: string
  requestID: string
}

/** 端口写出面；引擎只负责「发出事件」，端口的开关由 IPC 层管 */
interface PortSink {
  post: (event: PortEvent) => void
}

/** 兜底定时器的种类；四类各自独立，收尾时一起清掉 */
type RunTimerKey = 'start' | 'idle' | 'abort' | 'ceiling'

/** 一次运行在引擎里的登记项；事件先按 sessionID 找到它 */
interface RunHandle {
  runID: string
  sessionID: string
  sink: PortSink
  context: RunContext
  mapper: EventMapper
  /** prompt 请求自己的信号：本地取消时先把它放开，别让 await 挂着 */
  signal: AbortSignal
  /** 终态是否已落地（渲染侧只认第一个） */
  isSettled: boolean
  /** 模型是否真的开始干活了（收到过任何一个非 idle 事件） */
  hasStarted: boolean
  timers: Map<RunTimerKey, ReturnType<typeof setTimeout>>
  /** 放开可能还挂着的 prompt 请求 */
  release: () => void
  done: Promise<void>
  resolveDone: () => void
  /** 用量归属：跑的是谁的模型、记在哪个会话名下（`settle` 落账本要用） */
  accounting: RunAccounting
}

/** 一次运行的用量归属；在登记时就固定下来（终态事件本身不带这些信息） */
interface RunAccounting {
  /** studio 线程（会话）id；没带就是 null —— 账照样记，只是不归到任何会话 */
  threadID: string | null
  providerID: string
  model: string
  /** 凭据来源：`platform` = 组织网关（服务端也在计数）、`local` = 本机 BYOK */
  source: ProviderSource
}

/** 「studio 线程 → opencode 会话 + 目录」的解引用结果 */
interface SessionTarget {
  client: OpenCodeClient
  sessionID: string
  directory: string
}

/** 本次运行要用哪个 agent（档位）与哪个模型 */
interface RunTarget {
  agent: string
  model: ModelRef
}

interface EngineDeps {
  chat: ChatRepository
  keys: KeyStore
  log: Log
}

/** 审批等待上限：超时按拒绝处理，绝不把运行永久挂住 */
const APPROVAL_TIMEOUT_MS = 5 * 60_000
/**
 * `session.idle` 之后还给终态事件多少时间。
 *
 * 正常情况下 `session.execution.succeeded` 与 `session.idle` 差不多同时到；真没来就自己
 * 收尾 —— 界面不能永远停在「生成中」。
 */
const IDLE_GRACE_MS = 1_500
/**
 * prompt 入队后多久还没等到**任何**事件就算失败。
 *
 * v2 的 prompt 不再有响应头可以等（入队即返回），所以「provider 地址写错 / 凭据无效」这类
 * 问题在端口上表现成「什么都没发生」；没有这个看门狗，用户只会看到一个转圈。
 */
const START_WATCHDOG_MS = 60_000
/** 本地取消后等的兜底时间：中断事件没来也要收尾 */
const ABORT_GRACE_MS = 3_000
/** 单次运行的上限（事件流彻底断掉时的最后一道保险） */
const RUN_CEILING_MS = 60 * 60_000
/** 审批沿 parentID 上溯的最大层数（避免坏数据绕成环） */
const MAX_PARENT_DEPTH = 8

/** 非用户主动的中断原因 → 文案（表驱动，加一种原因加一行） */
const INTERRUPT_MESSAGES: Readonly<Record<string, string>> = {
  shutdown: 'opencode 服务已停止，本轮中断',
  inactivity: '长时间没有响应，本轮已中断'
}

/** 与 src/plugins/database.ts 同款：electron-store 的最小用法面适配 */
function toMappingStore(store: Store): MappingStore {
  return {
    toRead() {
      return store.store
    },
    toWrite(value) {
      store.store = value
    }
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Windows 上大小写不敏感，且路径可能带尾分隔符，比较前先归一 */
function isSameDirectory(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isSameModel(left: ModelRef | undefined, right: ModelRef): boolean {
  if (!left) return false
  return left.providerID === right.providerID && left.id === right.id
}

/**
 * 本次运行用哪个档位。
 *
 * 档位 = **一个自定义 primary agent 的 id**（`studio-auto|ask|readonly|chat`，规则集在
 * `permission.ts` 里编译、随进程配置下发），不是请求体参数 —— v2 的工具可见性只由 agent 的
 * permissions 决定。当前模型不支持工具时一律走聊天档：给它工具列表也没用，只会白花 token。
 */
function toRunAgentId(host: StartRequest['host']): string {
  const profile: AgentPermissionProfile =
    host?.supportsTools === false ? 'chat' : (host?.approval ?? 'ask')
  return toStudioAgentId(profile)
}

function toRunTarget(request: StartRequest): RunTarget {
  return {
    agent: toRunAgentId(request.host),
    model: { providerID: request.providerID, id: request.model }
  }
}

/** v2 的错误是结构化对象（`{type, message, status}`）或 Error，两种都要能翻成人话 */
function toRunErrorMessage(error: unknown): string {
  const record = toRecord(error)
  return findErrorMessage(record ? { ...record, message: describeOpencodeError(error) } : error)
}

/**
 * 终态事件 + 运行归属 → 账本条目。
 *
 * 用量缺失（服务端没报 / 老事件）时按 0 记但不跳过：**次数**本身也是事实，界面上
 * 「今日 N 次」不该因为没有 usage 就少一次。
 */
function toUsageRecord(accounting: RunAccounting, event: TerminalPortEvent): ChatUsageRecord {
  const usage = event.usage
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  return {
    runID: event.runID,
    sessionID: accounting.threadID,
    providerID: accounting.providerID,
    model: accounting.model,
    source: accounting.source,
    outcome: event.kind,
    inputTokens,
    outputTokens,
    totalTokens: usage?.totalTokens ?? inputTokens + outputTokens
  }
}

class OpencodeEngine {
  private readonly chat: ChatRepository
  private readonly keys: KeyStore
  private readonly log: Log
  private readonly server: OpencodeServerManager
  private readonly sessions: SessionStore

  private client: OpenCodeClient | null = null
  private clientURL: string | null = null
  private readonly runs = new Map<string, RunHandle>()
  /** sessionID → 当前那次运行；事件流按它分发 */
  private readonly sessionRuns = new Map<string, RunHandle>()
  /**
   * 全局事件流（v2 只有一条，不接受 directory）。
   * server 换端口或应用退出时断掉，下一次 run 重建。
   */
  private subscription: AbortController | null = null
  /** 串行化 server 的启动/重启：并发 prepare 必须看到同一个结论 */
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * 终态的唯一来源。
   *
   * `session.step.failed` / `session.retry.scheduled` 故意不在表里：那之后还会重试，
   * 提前报错会把「自动重试成功」的那一轮误判成失败。
   */
  private readonly terminalHandlers: Readonly<
    Record<string, (handle: RunHandle, data: Record<string, unknown>) => void>
  > = {
    // 用 bind 而不是箭头函数／方法简写：前者留不住 `this` 指向引擎，后者会把 `this` 变成这张表本身
    'session.execution.succeeded': this.onExecutionSucceeded.bind(this),
    'session.execution.failed': this.onExecutionFailed.bind(this),
    'session.execution.interrupted': this.onExecutionInterrupted.bind(this)
  }

  private onExecutionSucceeded(handle: RunHandle): void {
    this.settle(handle, { kind: 'finish', runID: handle.runID, ...handle.mapper.findResult() })
  }

  private onExecutionFailed(handle: RunHandle, data: Record<string, unknown>): void {
    this.settle(handle, {
      kind: 'error',
      runID: handle.runID,
      message: toRunErrorMessage(data.error)
    })
  }

  private onExecutionInterrupted(handle: RunHandle, data: Record<string, unknown>): void {
    const reason = toText(data.reason)
    // 用户点的取消、以及被新一轮取代，都不是错误
    if (reason === 'user' || reason === 'superseded') {
      this.settle(handle, { kind: 'aborted', runID: handle.runID })
      return
    }
    this.settle(handle, {
      kind: 'error',
      runID: handle.runID,
      message: INTERRUPT_MESSAGES[reason] ?? `本轮已中断（${reason || '原因未知'}）`
    })
  }

  constructor(deps: EngineDeps) {
    this.chat = deps.chat
    this.keys = deps.keys
    this.log = deps.log
    this.server = new OpencodeServerManager(deps.log, this.handleServerExit.bind(this))
    this.sessions = new SessionStore(toMappingStore(new Store({ name: OPENCODE_SESSION_STORE })))
  }

  async run(request: StartRequest, sink: PortSink, context: RunContext): Promise<void> {
    let handle: RunHandle | null = null
    let nextCount: number | null = null

    try {
      const provider = await this.chat.findProvider(request.providerID)
      if (!provider) throw new Error(`provider 不存在: ${request.providerID}`)

      const platformToken = request.host?.platformToken ?? null
      const tenantID = request.host?.tenantID ?? null
      const connection = resolveConnection(provider, {
        apiKey: this.keys.findKey(provider.id),
        platformToken,
        tenantID
      })
      if (typeof connection === 'string') throw new Error(connection)

      const client = await this.prepare(platformToken, tenantID)
      // 订阅必须早于任何一次 prompt：晚一步，这一轮的增量与审批事件就全漏了
      this.ensureSubscription(client)

      const target = await this.requireWorkspaceTarget(request)
      const session = await this.resolveSession(client, request, target.primaryPath, toRunTarget(request))
      handle = await this.registerRun(
        request,
        sink,
        context,
        session.sessionID,
        findProviderSource(provider.kind)
      )

      // 取消发生在登记之前的那几步里：这一轮不该再发出去，终态已由 registerRun 落地
      if (context.controller.signal.aborted) return

      const plan = planPrompt(request.messages, session.mapping, session.directory, target.folders)
      nextCount = plan.nextCount
      if (!plan.text && plan.files.length === 0) throw new Error('没有可发送的消息')

      await client.session.prompt(
        { sessionID: session.sessionID, text: plan.text, files: plan.files },
        { signal: handle.signal }
      )
      await handle.done
    } catch (error) {
      if (!handle) {
        // 还没走到建会话就失败了（provider 不存在 / 凭据无效）：没有 run 句柄，直接报错
        this.log.warn(`opencode run failed: ${toRunErrorMessage(error)}`)
        sink.post({ kind: 'error', runID: request.runID, message: toRunErrorMessage(error) })
      } else if (!handle.isSettled) {
        // 用户点了取消：这不是错误，给渲染侧一个正常的终止事件
        if (context.controller.signal.aborted) {
          this.settle(handle, { kind: 'aborted', runID: request.runID })
        } else {
          this.log.warn('opencode run failed', error)
          this.settle(handle, {
            kind: 'error',
            runID: request.runID,
            message: toRunErrorMessage(error)
          })
        }
      }
    } finally {
      if (handle) {
        // 记下已经转发到哪儿：opencode 自己持历史，下一轮不该把整段重发
        const threadID = request.host?.sessionID ?? null
        if (threadID && nextCount !== null) {
          this.sessions.toWrite(threadID, { sessionID: handle.sessionID, messageCount: nextCount })
        }
        this.clearRunTimers(handle)
        this.runs.delete(request.runID)
        if (this.sessionRuns.get(handle.sessionID) === handle) {
          this.sessionRuns.delete(handle.sessionID)
        }
      }
    }
  }

  /** 应用退出时收尾：停订阅、停 server */
  async dispose(): Promise<void> {
    this.clearSubscription()
    this.client = null
    this.clientURL = null
    await this.server.dispose()
  }

  /**
   * 内嵌 server 意外退出（崩溃 / 被外部杀掉）时的收尾。
   *
   * 它是运行的通路：进程没了，这一轮的增量与终态再也不会回来。不在这里结算的话，
   * 界面只能等运行上限（1 小时）兜底 —— 看起来就是「一直在生成中」。
   */
  private handleServerExit(): void {
    this.log.warn('opencode server 意外退出，收尾在途运行')
    this.clearSubscription()
    this.client = null
    this.clientURL = null

    for (const handle of [...this.runs.values()]) {
      this.settle(handle, {
        kind: 'error',
        runID: handle.runID,
        message: '内嵌 opencode 服务已退出，请重试'
      })
    }
  }

  /**
   * 本会话改了哪些文件（「已编辑 N 个文件」卡的数据源）。
   *
   * 没跑过 agent（server 还没起来）或映射丢了就返回空 —— 这里**不启动** server：
   * 只是看一眼变更，不该为此拉起一个进程。
   *
   * 注意数据源的限制：opencode 的文件快照只在**工作区是 git 仓库**时才有，
   * 所以非 git 工作区这里永远返回空报表（不是查询失败）。
   */
  async toReadChanges(threadID: string): Promise<ChangeReport> {
    const target = await this.findSessionTarget(threadID)
    if (!target) return EMPTY_REPORT

    const diffs = await this.findDiffs(target)
    if (!diffs) return EMPTY_REPORT

    return this.buildReport(target, diffs)
  }

  /**
   * 单个文件的 diff 原文（变更卡按需展开）。
   *
   * 与 `toReadChanges` 走同一条数据链路，只是取一条：清单里不带 patch 是因为它会被
   * 1.2s 轮询反复搬运，而一个 patch 可能有几十万字符。
   */
  async toReadPatch(threadID: string, changeID: string): Promise<string> {
    const target = await this.findSessionTarget(threadID)
    if (!target) return ''

    const diffs = await this.findDiffs(target)
    if (!diffs) return ''

    return toPatchText(diffs, target.directory, changeID)
  }

  /** 撤销：给了 `file` 只回退这一个，否则回退所有还生效的 */
  async toUndoChanges(threadID: string, file?: string): Promise<ChangeReport> {
    const target = await this.findSessionTarget(threadID)
    if (!target) return EMPTY_REPORT

    const diffs = await this.findDiffs(target)
    if (!diffs) return EMPTY_REPORT

    const report = this.buildReport(target, diffs)
    const selected = file
      ? report.entries.filter(function (entry) {
          return entry.id === file
        })
      : report.entries.filter(function (entry) {
          return !entry.undone
        })
    if (file && selected.length === 0) throw new Error(`变更不存在: ${file}`)

    for (const entry of selected) {
      // 路径来自 opencode，但仍按不可信输入处理：不许越出工作区
      const absolute = resolveInside(target.directory, entry.id)
      const patches = diffs.filter(function (diff) {
        return toRelativePath(target.directory, diff.file) === entry.id
      })
      applyUndo(absolute, applyChain(readCurrentText(absolute) ?? '', patches))
    }

    // 撤销完再查一次，返回真实剩余状态（写回失败 / 又被改的情况由它兜住）
    const remaining = await this.findDiffs(target)
    return remaining ? this.buildReport(target, remaining) : EMPTY_REPORT
  }

  /** 汇总报表，并带上「文件现在长什么样」让已撤销的条目自己掉队 */
  private buildReport(target: SessionTarget, diffs: readonly FileDiff[]): ChangeReport {
    const directory = target.directory
    return toChangeReport(diffs, directory, function (relative) {
      return readCurrentText(resolveInside(directory, relative))
    })
  }

  /** 找到「studio 线程 → opencode 会话 + 目录」，任一步缺失就返回 null */
  private async findSessionTarget(threadID: string): Promise<SessionTarget | null> {
    const client = this.client
    const mapping = this.sessions.find(threadID)
    if (!client || !mapping) return null

    const found = await this.findSession(client, mapping.sessionID)
    if (!found) {
      this.log.info('opencode 会话已不存在，略过变更查询')
      return null
    }

    return { client, sessionID: mapping.sessionID, directory: found.location.directory }
  }

  /** 读一个会话；读不到（不存在 / 服务不可用）返回 null，由调用方决定怎么办 */
  private async findSession(
    client: OpenCodeClient,
    sessionID: string
  ): Promise<SessionInfo | null> {
    try {
      return await client.session.get({ sessionID })
    } catch (error) {
      // 会话可能已被别处删掉，属正常情况：按不存在处理，但要出声
      this.log.warn(`读 opencode 会话失败，按不存在处理 (${sessionID})`, error)
      return null
    }
  }

  /**
   * 本会话改了哪些文件。
   *
   * v2 的 `session.diff({ sessionID })` **不再需要 messageID**（v1 是「不带 messageID 恒返回空」，
   * 得先把会话里的用户消息列出来逐条问），一次调用给全量。
   */
  private async findDiffs(target: SessionTarget): Promise<FileDiff[] | null> {
    try {
      const raw = await target.client.session.diff({ sessionID: target.sessionID })
      return raw
        .map(function (item) {
          return toFileDiff(item)
        })
        .filter(function (item): item is FileDiff {
          return item !== null
        })
    } catch (error) {
      this.log.warn(`读取变更失败: ${describeOpencodeError(error)}`)
      return null
    }
  }

  /**
   * 拿到一个连到「跑着本次配置」的 server 的客户端。
   *
   * 配置里带上了**全部工作区的根**（`findAllWorkspaceFolders`）而不是当前这一个：opencode 的
   * 配置是 server 级、且改动要重启，而工作区的其它根是「工作区外」的授权来源（见 permission.ts）。
   * 只算当前工作区的话，用户每切一次工作区都要白重启一次 server。
   */
  private async prepare(
    platformToken: string | null,
    tenantID: string | null
  ): Promise<OpenCodeClient> {
    const rows = await this.chat.findProviders()
    const apiKeys = new Map<string, string>()
    for (const row of rows) {
      const key = this.keys.findKey(row.id)
      if (key) apiKeys.set(row.id, key)
    }

    const { config } = buildOpencodeConfig({
      providers: rows,
      credentials: { apiKeys, platformToken, tenantID },
      folders: await findAllWorkspaceFolders()
    })

    const signature = toConfigSignature(config)
    const engine = this
    return this.enqueue(function () {
      return engine.ensureServer(config, signature)
    })
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.then(
      function () {},
      function () {}
    )
    return next
  }

  private async ensureServer(
    config: Record<string, unknown>,
    signature: string
  ): Promise<OpenCodeClient> {
    const handle = await this.server.ensure(signature, config, {
      // 配置变了要重启 server，而有运行在途时重启等于把那次运行杀掉 —— 宁可本次沿用旧配置
      deferIfRunning: this.sessionRuns.size > 0
    })

    if (this.client && this.clientURL === handle.url) return this.client

    this.client = createClient(handle.url, handle.password)
    this.clientURL = handle.url
    // server 换了（新端口 = 新实例）：旧的流全指向死地址，清掉，下一次 run 重建
    this.clearSubscription()
    return this.client
  }

  /**
   * 全局事件流，一个 client 一条。
   *
   * v2 的 `event.subscribe()` 不接受 directory，收到的是所有会话的事件；分发时按 sessionID
   * 找登记项即可。SDK 只管拉流，重连由调用方负责 —— 流断了就置空，下一次 run 重建。
   */
  private ensureSubscription(client: OpenCodeClient): void {
    if (this.subscription) return

    const subscription = new AbortController()
    this.subscription = subscription
    void this.consumeEvents(client, subscription)
  }

  private async consumeEvents(
    client: OpenCodeClient,
    subscription: AbortController
  ): Promise<void> {
    try {
      for await (const event of client.event.subscribe({ signal: subscription.signal })) {
        if (subscription.signal.aborted) return
        this.route(event as unknown as OpencodeEvent)
      }
    } catch (error) {
      if (!subscription.signal.aborted) this.log.warn('opencode 事件流中断', error)
    } finally {
      // 只有「还是当前这条」才清空：否则会把换新 client 时建的那条误清掉
      if (this.subscription === subscription) this.subscription = null
    }
  }

  private clearSubscription(): void {
    const subscription = this.subscription
    this.subscription = null
    subscription?.abort()
  }

  private route(event: OpencodeEvent): void {
    const type = typeof event.type === 'string' ? event.type : ''

    // 审批可能来自子代理自己起的会话，所以先按事件里的 sessionID 找到归属再谈别的
    if (type === 'permission.asked') {
      void this.answerPermission(event.data)
      return
    }

    const sessionID = toText(toRecord(event.data)?.sessionID)
    if (!sessionID) return

    const handle = this.sessionRuns.get(sessionID)
    if (!handle) return

    // `session.idle` 是「这一轮跑完了」的存活信号，终态事件不一定跟着来
    if (type === 'session.idle') {
      this.startIdleGuard(handle)
      return
    }

    // 收到任何事件都说明模型真的开始干活了：把「没开始」的看门狗撤掉
    this.markStarted(handle)

    const terminal = this.terminalHandlers[type]
    if (terminal) {
      terminal(handle, toRecord(event.data) ?? {})
      return
    }

    for (const portEvent of handle.mapper.map(event)) {
      if (portEvent.kind === 'error') this.log.warn(`opencode session error: ${portEvent.message}`)
      this.post(handle, portEvent)
    }
  }

  /**
   * 审批拍板。
   *
   * 档位**不在这里判断**：它已经编译进 agent 的 permissions（auto 档直接 allow、readonly 档
   * 直接 deny，模型都看不到那些工具），所以服务端只会在真正需要人拍板时才问。这里做的是
   * 「找到归属的运行 → 问渲染进程 → 把回执发给提问的那个会话」。
   */
  private async answerPermission(raw: unknown): Promise<void> {
    const data = toRecord(raw)
    const sessionID = toText(data?.sessionID)
    const requestID = toText(data?.id)
    if (!data || !sessionID || !requestID) return

    const handle = await this.findRunForSession(sessionID)
    if (!handle) {
      // 找不到归属（提问的会话已经收尾）：宁可拒绝，也不能让服务端一直等下去
      this.log.warn(`审批找不到归属的运行，按拒绝处理 (${sessionID})`)
      await this.replyPermission(sessionID, requestID, false)
      return
    }

    const request = handle.mapper.map({ type: 'permission.asked', data }).find(function (event) {
      return event.kind === 'tool-approval-request'
    })
    if (!request || request.kind !== 'tool-approval-request') {
      // 事件形状没认出来：同样宁可拒绝，也不让服务端悬着
      await this.replyPermission(sessionID, requestID, false)
      return
    }

    const ticket = createApprovalTicket({
      signal: handle.context.controller.signal,
      timeoutMs: APPROVAL_TIMEOUT_MS
    })
    handle.context.approvals.set(request.toolCallId, { ticket, sessionID, requestID })
    this.post(handle, request)

    try {
      const approved = await ticket.decision
      this.log.info(`工具审批: ${request.toolName} => ${approved ? '放行' : '拒绝'}`)
      await this.replyPermission(sessionID, requestID, approved)
    } finally {
      handle.context.approvals.delete(request.toolCallId)
      ticket.dispose()
    }
  }

  /**
   * 审批归谁：先看提问的会话本身，再看它的父会话（子代理的审批要弹到父运行的界面上）。
   * 一路找不到就返回 null —— 调用方按拒绝处理（fail-closed）。
   */
  private async findRunForSession(sessionID: string): Promise<RunHandle | null> {
    const direct = this.sessionRuns.get(sessionID)
    if (direct) return direct

    const client = this.client
    if (!client) return null

    let current = sessionID
    for (let depth = 0; depth < MAX_PARENT_DEPTH; depth += 1) {
      const found = await this.findSession(client, current)
      const parentID = found?.parentID ?? ''
      if (!parentID) return null

      const parent = this.sessionRuns.get(parentID)
      if (parent) return parent
      current = parentID
    }

    return null
  }

  private async replyPermission(
    sessionID: string,
    requestID: string,
    approved: boolean
  ): Promise<void> {
    const client = this.client
    if (!client) return

    try {
      await client.permission.reply({
        sessionID,
        requestID,
        decision: toPermissionDecision(approved)
      })
    } catch (error) {
      this.log.warn(`工具审批回执失败: ${describeOpencodeError(error)}`)
    }
  }

  /** 取消服务端那一轮；只 abort 本地请求的话它会继续跑下去 */
  private async interruptSession(sessionID: string): Promise<void> {
    const client = this.client
    if (!client) return

    try {
      await client.session.interrupt({ sessionID })
    } catch (error) {
      this.log.warn(`取消 opencode 运行失败: ${describeOpencodeError(error)}`)
    }
  }

  /** 登记一次运行：让上一轮真正收尾、建票据、接管 abort、支起兜底定时器 */
  private async registerRun(
    request: StartRequest,
    sink: PortSink,
    context: RunContext,
    sessionID: string,
    source: ProviderSource
  ): Promise<RunHandle> {
    // 同一会话上的上一轮还没结束（用户在生成中途又发了一条）：必须等它**真正**收尾再登记。
    // 只做本地 `settle` 不行 —— 服务端那一轮还在跑，它稍后发来的终态（session.execution.*）
    // 会被 `route()` 按会话归到刚登记的新手上：旧轮的 Interrupted 让新消息刚发就显示「已停止」，
    // 旧轮的 Succeeded 会拿它的结果给新一轮收尾（这一轮的结果再也进不来）。
    //
    // 复用取消通路（放开 prompt + 让服务端停下），等待有界：一次事件都没等到就立即落地，
    // 否则由 ABORT_GRACE_MS 兜底，不会把新一轮卡住。
    //
    // 残留风险：兜底情景下（服务端在宽限期内没回终态）本地先落地了，那条迟到的终态仍可能
    // 落到新一轮身上 —— 事件只带 sessionID，从事件本身判不出归属。
    const previous = this.sessionRuns.get(sessionID)
    if (previous) {
      previous.context.controller.abort()
      await previous.done
    }

    const stopController = new AbortController()
    const handle: RunHandle = {
      runID: request.runID,
      sessionID,
      sink,
      context,
      mapper: createEventMapper(request.runID),
      signal: stopController.signal,
      isSettled: false,
      hasStarted: false,
      timers: new Map(),
      accounting: {
        threadID: request.host?.sessionID ?? null,
        providerID: request.providerID,
        model: request.model,
        source
      },
      release() {
        stopController.abort()
      },
      done: Promise.resolve(),
      resolveDone() {}
    }
    handle.done = new Promise<void>(function (resolve) {
      handle.resolveDone = resolve
    })

    this.runs.set(request.runID, handle)
    this.sessionRuns.set(sessionID, handle)

    const engine = this
    function onAbort(): void {
      handle.release()

      // 服务端那一轮可能已经收下了 prompt，无论如何都要让它停下
      void engine.interruptSession(sessionID)

      // 一次事件都没等到就取消：服务端还没真正开跑，直接收尾，不必再等中断事件回来
      if (!handle.hasStarted) {
        engine.settle(handle, { kind: 'aborted', runID: handle.runID })
        return
      }

      engine.setRunTimer(handle, 'abort', ABORT_GRACE_MS, function () {
        engine.log.info('取消后没等到中断事件，直接收尾')
        engine.settle(handle, { kind: 'aborted', runID: handle.runID })
      })
    }

    // 登记之前的那几步（找 provider、起 server、建会话）都是 await，用户完全可能在途中点取消；
    // 那种情况下 abort 事件早就过去了，只挂监听等于把这次取消丢掉（要等上限兜底）。
    if (context.controller.signal.aborted) onAbort()
    else context.controller.signal.addEventListener('abort', onAbort, { once: true })

    // 上面这一路可能已经就地收尾了（登记前就被取消）：兜底定时器只会在一个已落地的运行上白等
    if (handle.isSettled) return handle

    this.setRunTimer(handle, 'start', START_WATCHDOG_MS, function () {
      engine.settle(handle, {
        kind: 'error',
        runID: handle.runID,
        message: '模型没有开始响应，请检查 provider 的服务地址与凭据后重试'
      })
    })
    this.setRunTimer(handle, 'ceiling', RUN_CEILING_MS, function () {
      engine.log.warn('运行时间超过上限，强制中断')
      void engine.interruptSession(sessionID)
      engine.settle(handle, {
        kind: 'error',
        runID: handle.runID,
        message: '运行时间超过上限，已中断'
      })
    })

    return handle
  }

  /** 开始过就撤掉「没开始」的看门狗；后续事件的到来不再需要判断 */
  private markStarted(handle: RunHandle): void {
    if (handle.hasStarted) return
    handle.hasStarted = true
    this.clearRunTimer(handle, 'start')
  }

  /**
   * `session.idle` 说明服务端这一轮跑完了，但终态事件偶发会晚一拍。给它一点宽限；
   * 真的不来就自己落地终态，界面不能永远停在「生成中」。
   *
   * 一次事件都没收到过就先不动：那是「还没起来」，交给 start 看门狗 —— 在这里收尾会把
   * 「模型没开始」误报成「正常结束」。
   */
  private startIdleGuard(handle: RunHandle): void {
    if (!handle.hasStarted || handle.isSettled) return

    const engine = this
    this.setRunTimer(handle, 'idle', IDLE_GRACE_MS, function () {
      engine.log.info('会话已空闲但没等到终态事件，按正常结束收尾')
      engine.settle(handle, { kind: 'finish', runID: handle.runID, ...handle.mapper.findResult() })
    })
  }

  /** 过程事件：只发，不改变运行状态（终态由 `settle` 负责） */
  private post(handle: RunHandle, event: PortEvent): void {
    if (handle.isSettled) return
    handle.sink.post(event)
  }

  /**
   * 终态落地（幂等）。
   *
   * 多个出口（`session.execution.*` / 各类兜底定时器 / prompt 抛错）都会走到这里，
   * 渲染侧只认第一个，所以重复调用必须无害：清定时器、放开挂着的 prompt、发一次终态、放行 await。
   *
   * 用量账本也在这里落 —— 这是**唯一**的终态汇聚点，所以在 `settle` 之外再没有第二处记账，
   * 也就不存在「某个出口忘了记」。顺序是「先记账、再发终态」：反过来的话界面已经显示用量、
   * 库里却还没有，用户刷新一下就归零。
   */
  private settle(handle: RunHandle, event: TerminalPortEvent): void {
    if (handle.isSettled) return
    handle.isSettled = true
    this.clearRunTimers(handle)
    handle.release()

    // 终态事件的用量由映射层统一补（取消 / 报错这些出口自己造的事件里没有用量）
    const settled = handle.mapper.withUsage(event)
    this.chat.appendUsage(toUsageRecord(handle.accounting, settled))

    handle.sink.post(settled)
    handle.resolveDone()
  }

  private setRunTimer(handle: RunHandle, key: RunTimerKey, ms: number, run: () => void): void {
    this.clearRunTimer(handle, key)
    handle.timers.set(
      key,
      setTimeout(function () {
        handle.timers.delete(key)
        run()
      }, ms)
    )
  }

  private clearRunTimer(handle: RunHandle, key: RunTimerKey): void {
    const timer = handle.timers.get(key)
    if (timer === undefined) return
    clearTimeout(timer)
    handle.timers.delete(key)
  }

  private clearRunTimers(handle: RunHandle): void {
    for (const timer of handle.timers.values()) clearTimeout(timer)
    handle.timers.clear()
  }

  /**
   * agent 的运行目标：工作目录**必须真的在磁盘上**，否则工具没有落点。
   *
   * 必须给权威解析的结果：退到别处（历史上是 studio 私有沙箱）的后果不是「少点功能」——
   * 模型的工作目录成了空目录，它会转而满盘去找用户嘴里提到的目录，工作区里的每条路径
   * 也都会变成「工作区外」，连自动审批档都要为它们弹审批。解析不到就直接报错，让用户去加工作区。
   */
  private async requireWorkspaceTarget(request: StartRequest): Promise<WorkspaceTarget> {
    const target = await resolveWorkspaceTarget(request.host?.workspaceID)
    if (!target) {
      throw new Error('没有可用的工作区目录：请先在左侧添加一个工作区文件夹')
    }
    return target
  }

  /**
   * studio 线程 → opencode 会话。
   *
   * 会话存在就复用（历史在服务端，重发会重复）；会话被删掉、或工作区换了，
   * 就新建一个 —— 一个 opencode 会话只属于一个目录。
   *
   * 档位与模型的切换必须在 `registerRun` **之前**做完：切档本身会发
   * `session.agent.selected` / `session.model.selected`，那会被当成「本轮已经开始」。
   */
  private async resolveSession(
    client: OpenCodeClient,
    request: StartRequest,
    directory: string,
    target: RunTarget
  ): Promise<{ sessionID: string; directory: string; mapping: SessionMapping | null }> {
    const threadID = request.host?.sessionID ?? null
    const existing = threadID ? this.sessions.find(threadID) : null

    if (existing) {
      const found = await this.findSession(client, existing.sessionID)
      if (found) {
        if (isSameDirectory(found.location.directory, directory)) {
          await this.applyRunTarget(client, found, target)
          return { sessionID: found.id, directory: found.location.directory, mapping: existing }
        }
        this.log.info(
          `工作区已变化，为本次会话新建 opencode 会话（原目录 ${found.location.directory}）`
        )
      } else {
        this.log.info('opencode 会话已不存在，新建一个')
      }
    }

    const created = await client.session.create({
      title: toSessionTitle(request),
      agent: target.agent,
      model: target.model,
      location: { directory }
    })
    return { sessionID: created.id, directory, mapping: null }
  }

  /** 档位与模型都只在**变化时**才切：切换本身会写事件、也会打断模型缓存 */
  private async applyRunTarget(
    client: OpenCodeClient,
    session: SessionInfo,
    target: RunTarget
  ): Promise<void> {
    try {
      if (session.agent !== target.agent) {
        await client.session.switchAgent({ sessionID: session.id, agent: target.agent })
      }
      if (!isSameModel(session.model, target.model)) {
        await client.session.switchModel({ sessionID: session.id, model: target.model })
      }
    } catch (error) {
      throw new Error(`切换运行档位失败: ${describeOpencodeError(error)}`)
    }
  }
}

let engine: OpencodeEngine | null = null

/** 引擎的唯一实例：整个应用共用一个 opencode server */
function findEngine(deps: EngineDeps): OpencodeEngine {
  if (!engine) engine = new OpencodeEngine(deps)
  return engine
}

/**
 * 已存在的实例，没有就 null。
 *
 * 给「只想读一眼状态」的调用方用（变更汇总）——它们不该为了看一眼就创建引擎、
 * 更不该顺手拉起 opencode server。
 */
function findEngineIfAny(): OpencodeEngine | null {
  return engine
}

async function disposeEngine(): Promise<void> {
  const current = engine
  engine = null
  if (current) await current.dispose()
}

export { disposeEngine, findEngine, findEngineIfAny, OpencodeEngine }
export type { EngineDeps, PortSink, RunContext, RunHandle, ChangeReport }
