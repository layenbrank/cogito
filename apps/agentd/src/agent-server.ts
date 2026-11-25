/**
 * Agent Protocol 的最小自托管实现（`/threads`、`/threads/:id/state`、`/threads/:id/runs/stream`）。
 *
 * ## 为什么自写（替代 `@skein-js/*`）
 *
 * `@skein-js/server-kit` 的传递依赖 `@langchain/langgraph-ui` 含 top-level await，
 * 与 SEA 只执行 CJS 入口互斥（详见 ADR §6.1 与 `.cogito/plans/findings.md` §9.1）。
 * `@langchain/langgraph` 本身可以正常 CJS 打包，所以只自写协议壳。
 *
 * ## 兼容目标
 *
 * 形状对齐 `@langchain/langgraph-sdk` 的 `Client`：`threads.create()`、`runs.stream()`、
 * `threads.getState()`。不是完整 Agent Protocol（assistants/store/cron 都没有），
 * 只覆盖桌面端真正要用的面；SDK 兼容性由 `agent-server.sdk.test.ts` 守着。
 */

import { randomUUID } from 'node:crypto'

import { Command } from '@langchain/langgraph'
import type { Express, Request, Response } from 'express'

import type { ApprovalHub } from './approvals'
import type { ElicitationDecision, ElicitationHub } from './elicitations'
import { classifyRunFailure, toErrorExcerpt } from './error-kind'
import type { EventHub, RunEvent } from './events'
import type { Metrics } from './observability'
import { isAllowedGooseMethod } from './goose/allowlist'
import type { SessionRegistry } from './session-registry'
import {
  isAllowedSessionConfigID,
  parseAfterQuery,
  validateCwd,
  validateEpoch,
  validateMcpServers,
  validateThreadID
} from './validation'

const GRAPH_NAME = 'agent'

/**
 * LangGraph 编译产物我们只用两个方法，且**不 import 它的类型**（保持协议层解耦）。
 * 用方法语法（而非属性函数）让参数按双变处理，避免为了一个 `streamMode` 字面量
 * 把 graph 的类型参数抄一遍。
 */
interface CompiledGraphLike {
  stream(input: unknown, options: unknown): Promise<AsyncIterable<unknown>>
  getState?(options: unknown): Promise<unknown>
}

interface AgentServerOptions {
  graph: CompiledGraphLike
  graphName?: string
  /**
   * goose 的查询面（P4-a）。
   *
   * 不直接 import supervisor：协议层只认「能按 ACP 方法名发请求」这一件事，
   * 生命周期属于 `goose/supervisor.ts`。为 null 时这些路由返回 503（未就绪）。
   */
  goose?: GooseQueryPort | null
  /** 工具审批闸门；为 null 时 `/threads/:id/approvals` 一律 503 */
  approvals?: ApprovalHub | null
  /** 结构化追问闸门；为 null 时 `/threads/:id/elicitations` 一律 503 */
  elicitations?: ElicitationHub | null
  /** 会话事件流（`session/update` 与审批）；为 null 时 `/threads/:id/events` 一律 503 */
  events?: EventHub | null
  /** 计数器（runs / approvals / sse）；为 null 时只是不计数，行为不变 */
  metrics?: Metrics | null
  /** 结构化日志（`AGENTD_EVENT` 一行一条）；为 null 时退化成不打 */
  logEvent?: ((name: string, fields?: Record<string, unknown>) => void) | null
  /** thread → goose session 的内存登记（取消路径要在 checkpoint 落盘前拿到 sessionId） */
  sessions?: SessionRegistry | null
  /** 信任边界：工作区根与 MCP 命令白名单；缺省时只校验存在性与绝对路径 */
  validation?: {
    allowedRoots: readonly string[]
    mcpAllowedCommands: readonly string[]
    allowBareMcpCommand: boolean
    allowArbitraryMcpCommand: boolean
  } | null
}

interface GooseQueryPort {
  request(method: string, params?: unknown): Promise<unknown>
  cancel(sessionId: string): Promise<void>
  /**
   * 订阅 `session/update`（补历史要用：`session/load` 的重放是**通知**，没人监听就丢了）。
   * 不实现时 `/threads/:id/replay` 一律 503。
   */
  onSessionUpdate?: (listener: (sessionId: string, update: unknown) => void) => () => void
}

interface AgentServer {
  readonly name: string
  mount(app: Express): void
  graphs(): readonly string[]
  /** 关停时先断开长驻 SSE，否则 `server.close()` 永远等不到回调 */
  closeConnections(): void
  stop(): Promise<void>
}

interface ThreadRecord {
  thread_id: string
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

/** 正在跑的那一轮（同线程只允许一个）。 */
interface ActiveRun {
  runID: string
  controller: AbortController
  startedAt: number
  /** 发起这一轮的客户端身份（`x-cogito-client`）；旧客户端 / 未知身份为空串 */
  clientID: string
  /** 这个线程上的第几轮（从 1 递增）：冲突时报出去，便于两边对账 */
  revision: number
}

/** 抢占旧轮时等它落地的上限：超过就继续开新的（宁可丢旧轮，也不要卡在发送中）。 */
const PREEMPT_WAIT_MS = 1500
const PREEMPT_POLL_MS = 50
/**
 * 写者租约的过期时间：持有者的轮次停了这么久还没收尾，就认为它已经不在（进程被强杀 /
 * 客户端崩溃），允许别的客户端直接接管 —— 否则一个死掉的窗口能把整个会话永久锁住。
 */
const RUN_LEASE_STALE_MS = 10 * 60_000
/** thread 登记上限：超过时淘汰最久未用且没有活跃轮的线程（客户端下一次 run 会重新 upsert） */
const MAX_THREADS = 2_000

function nowIso(): string {
  return new Date().toISOString()
}

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** `/runs/stream` 的 input 必须带上 threadID，否则图不知道自己在服务哪个线程（审批回查用）。 */
function withThreadID(input: unknown, threadID: string): unknown {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return { ...(input as Record<string, unknown>), threadID }
  }
  return { threadID }
}

/** `graph.stream` 在不同 streamMode 下的形状不同：多 mode 时给 `[mode, chunk]` */
function toReadChunk(chunk: unknown): { mode: string; value: unknown } {
  if (Array.isArray(chunk) && chunk.length === 2 && typeof chunk[0] === 'string') {
    return { mode: chunk[0], value: chunk[1] }
  }
  return { mode: 'values', value: chunk }
}

/**
 * 重放里哪些 update 值得回放：正文 / 推理 / 工具。
 *
 * `usage_update`、`available_commands_update`、`session_info_update` 也会跟着重放，
 * 但它们不是「缺的那段正文」，推给客户端只会白刷一遍侧栏状态。
 */
const REPLAY_UPDATE_KINDS = new Set([
  'user_message_chunk',
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update'
])

function toReadReplayUpdate(update: unknown): unknown | null {
  if (typeof update !== 'object' || update === null) return null
  const kind = (update as { sessionUpdate?: unknown }).sessionUpdate
  return typeof kind === 'string' && REPLAY_UPDATE_KINDS.has(kind) ? update : null
}

function createAgentServer(options: AgentServerOptions): AgentServer {
  const graphName = options.graphName ?? GRAPH_NAME
  const threads = new Map<string, ThreadRecord>()
  const activeRuns = new Map<string, ActiveRun>()
  /** 每个线程上跑过几轮：冲突 / 回包都带它，两边对账用 */
  const runRevisions = new Map<string, number>()
  const sessions = options.sessions ?? null
  const limits = options.validation ?? null
  /** 长驻 SSE 连接：关停时主动结束，`server.close()` 才有机会回调 */
  const SSEConnections = new Set<Response>()
  const approvals = options.approvals ?? null
  const elicitations = options.elicitations ?? null
  const events = options.events ?? null
  const metrics = options.metrics ?? null
  const logEvent = options.logEvent ?? null
  /** 正在补历史的 thread：同一时刻只允许一次，两次并发会让重放通知交叉成两份 */
  const replayInFlight = new Set<string>()

  // 审批与追问都汇进同一条流：前端只消费 `/threads/:id/events` 一个通道
  approvals?.subscribe(function (event) {
    if (event.type === 'approval_requested') metrics?.inc('approvals.requested')
    else metrics?.inc('approvals.settled')
    logEvent?.('approval', {
      threadID: event.approval.threadID,
      status: event.type === 'approval_settled' ? 'settled' : 'requested',
      gooseSessionId: event.approval.sessionId
    })
    events?.emit(
      event.approval.threadID,
      event.type === 'approval_requested' ? 'approval' : 'approval_settled',
      event
    )
  })
  elicitations?.subscribe(function (event) {
    if (event.type === 'elicitation_requested') metrics?.inc('elicitations.requested')
    else metrics?.inc('elicitations.settled')
    logEvent?.('elicitation', {
      threadID: event.elicitation.threadID,
      status: event.type === 'elicitation_settled' ? 'settled' : 'requested',
      gooseSessionId: event.elicitation.sessionId
    })
    events?.emit(
      event.elicitation.threadID,
      event.type === 'elicitation_requested' ? 'elicitation' : 'elicitation_settled',
      event
    )
  })

  function toReadThreadID(req: Request): string {
    return String(req.params.threadId ?? '')
  }

  /** 任意路由参数（goose 那组用 `:sessionId`，没有 thread 语义）。 */
  function toReadParam(req: Request, name: string): string {
    return String((req.params as Record<string, unknown>)[name] ?? '')
  }

  function ensureThread(threadID: string): ThreadRecord | null {
    return threads.get(threadID) ?? null
  }

  /** 图状态里的 `sessionId`（取消时要拿它发 ACP cancel）；拿不到就返回 null。 */
  async function readSessionID(threadID: string): Promise<string | null> {
    // 内存登记优先：首轮在 session/new 之后、checkpoint 落盘之前，只有这里有
    const remembered = sessions?.find(threadID)
    if (remembered) return remembered
    if (!options.graph.getState) return null
    try {
      const state = (await options.graph.getState({
        configurable: { thread_id: threadID }
      })) as { values?: Record<string, unknown> } | undefined
      const value = state?.values?.sessionId
      return typeof value === 'string' && value ? value : null
    } catch {
      return null
    }
  }

  /**
   * 补历史用的运行配置：goose 会话 id + 该会话创建时的 cwd / MCP 名单。
   *
   * `mcpServers` 必须用**会话创建时那一份**（空数组在 goose 侧表示「不改」）：
   * 自己重新推导会把「本轮 `withTools=false`」的会话悄悄挂回全部工具。
   */
  async function toReadReplayConfig(threadID: string): Promise<{
    sessionID: string
    cwd: string
    MCPServers: readonly unknown[]
  } | null> {
    if (!options.graph.getState) return null
    const remembered = sessions?.find(threadID) ?? ''
    try {
      const state = (await options.graph.getState({
        configurable: { thread_id: threadID }
      })) as { values?: Record<string, unknown> } | undefined
      const values = state?.values ?? {}
      const sessionID =
        typeof values.sessionId === 'string' && values.sessionId ? values.sessionId : remembered
      const cwd = typeof values.cwd === 'string' ? values.cwd : ''
      if (!sessionID || !cwd) return null
      const MCPServers = Array.isArray(values.mcpServers) ? values.mcpServers : []
      return { sessionID, cwd, MCPServers }
    } catch (error) {
      // 读不到状态 = 这个 thread 还没有 checkpoint；补不了历史，让调用方按「无会话」处理
      console.warn(`[agent] 读取补历史所需状态失败（thread=${threadID}）：${String(error)}`)
      return null
    }
  }

  /**
   * 补历史：把 goose 的会话历史重放成一批 `replay` 事件（R5-D3，
   * 见 `docs/decisions/agent-r5-hardening.md`）。
   *
   * 只有事件日志已淘汰（`sync.truncated`）时才需要它：那时正文与工具卡真的缺段，
   * 而 goose 侧历史是唯一权威来源（checkpoint 的 `reply` 只有最后一轮）。
   *
   * 三条硬约束：
   * 1. **本轮不能有活跃 run**：`session/load` 会把会话挂回连接，与 live 流交叉会乱序；
   * 2. **MCP 名单用会话创建时那一份**（见 `toReadReplayConfig`）；
   * 3. **失败不抛**：补历史是旁路，拿不到就留诊断让用户重发，不能把这一轮带崩。
   */
  async function handleReplay(req: Request, res: Response): Promise<void> {
    const threadID = toReadThreadID(req)
    if (!ensureThread(threadID)) {
      res.status(404).json({ error: 'thread_not_found' })
      return
    }
    const goose = options.goose
    const subscribe = goose?.onSessionUpdate
    if (!goose || !subscribe) {
      res.status(503).json({ error: 'goose_unavailable' })
      return
    }
    if (activeRuns.has(threadID)) {
      res.status(409).json({ error: 'run_active', message: '这一轮还在跑，等它结束再补历史' })
      return
    }
    if (replayInFlight.has(threadID)) {
      res.status(409).json({ error: 'replay_in_flight', message: '同一会话正在补历史' })
      return
    }

    const config = await toReadReplayConfig(threadID)
    if (!config) {
      res.status(200).json({ replayed: 0, reason: 'no_session' })
      return
    }

    replayInFlight.add(threadID)
    let replayed = 0
    const unsubscribe = subscribe(function (sessionID, update) {
      if (sessionID !== config.sessionID) return
      const payload = toReadReplayUpdate(update)
      if (!payload) return
      replayed += 1
      events?.emit(threadID, 'replay', payload)
    })
    try {
      await goose.request('session/load', {
        // `sessionId` / `mcpServers` 是 ACP 的线格式字段名，不跟着本地命名改
        sessionId: config.sessionID,
        cwd: config.cwd,
        mcpServers: config.MCPServers
      })
      logEvent?.('run.replay', { threadID, replayed })
      res.json({ replayed })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logEvent?.('run.replay_failed', { threadID, error: toErrorExcerpt(message) })
      res.status(502).json({ error: 'replay_failed', message })
    } finally {
      unsubscribe()
      replayInFlight.delete(threadID)
    }
  }

  async function waitForIdle(threadID: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!activeRuns.has(threadID)) return true
      await new Promise<void>(function (resolve) {
        setTimeout(resolve, PREEMPT_POLL_MS)
      })
    }
    return !activeRuns.has(threadID)
  }

  /**
   * 抢占同一线程上的旧轮。
   *
   * 前端「改了内容重新发」会在旧轮还没收尾时发新的一轮。这里先让 goose 停（ACP
   * `session/cancel` 是唯一真正能收住长工具的），再中止图，最后等一个有限窗口。
   * 等不到也不堵着 —— 抛错会让界面停在「发送中」，那是比丢一轮旧上下文更糟的体验。
   */
  async function preempt(threadID: string): Promise<void> {
    const active = activeRuns.get(threadID)
    if (!active) return
    metrics?.inc('runs.preempted')
    logEvent?.('run.preempt', { threadID, runID: active.runID })
    const sessionID = await readSessionID(threadID)
    if (sessionID && options.goose) {
      try {
        await options.goose.cancel(sessionID)
      } catch {
        // goose 已经没了 / 没在跑：继续掉图
      }
    }
    active.controller.abort()
    const idle = await waitForIdle(threadID, PREEMPT_WAIT_MS)
    if (!idle) {
      console.warn(`[agent] 旧轮未在 ${PREEMPT_WAIT_MS}ms 内收尾，仍然继续开新一轮（thread=${threadID}）`)
    }
  }

  /** 客户端身份（`x-cogito-client`）：只做长度/字符集归一，不合法就当未知身份 */
  function toReadClientID(req: Request): string {
    const raw = (req.get('x-cogito-client') ?? '').trim()
    if (!raw) return ''
    const safe = raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64)
    return safe
  }

  /** 请求体里的 `takeover: true`：用户明确要求接管别的客户端的轮次 */
  function toReadTakeover(body: unknown): boolean {
    if (!body || typeof body !== 'object') return false
    return (body as { takeover?: unknown }).takeover === true
  }

  /**
   * 写者租约：这一轮能不能由 `clientID` 开始启？
   *
   * - 自己旧的一轮（同 clientID）→ 可以：那就是「重发 / 改完再发」的 supersede；
   * - 别人的一轮 → 只有用户显式 `takeover` 才允许，另一种是持有者已经超过
   *   `RUN_LEASE_STALE_MS` 没收尾（进程被强杀 / 客户端崩了，否则会把会话永久锁死）；
   * - 未知身份（旧客户端没带 header）→ 保持旧行为，不拦。
   *
   * 拦下来的回包是 409 `writer_lease_held`，带持有者信息，客户端据此提示「另一个窗口在跑」。
   */
  function canTakeWriterLease(
    active: ActiveRun | undefined,
    clientID: string,
    takeover: boolean
  ): boolean {
    if (!active) return true
    if (takeover) return true
    if (!active.clientID || !clientID) return true
    if (active.clientID === clientID) return true
    return Date.now() - active.startedAt > RUN_LEASE_STALE_MS
  }

  /** 409 的统一形状：客户端靠 `error` 字段判断，不用去解析文案 */
  function rejectWriterLease(res: Response, active: ActiveRun): void {
    metrics?.inc('runs.lease_conflicts')
    logEvent?.('run.lease_conflict', {
      threadID: active.runID,
      runID: active.runID,
      revision: active.revision
    })
    res.status(409).json({
      error: 'writer_lease_held',
      message: '这个会话正在被另一个窗口执行；如需接手请先确认',
      holder: {
        clientID: active.clientID,
        runID: active.runID,
        revision: active.revision,
        startedAt: active.startedAt
      }
    })
  }

  /** 每线程轮次号：冲突 / 回包里带上它，两端对账就不用猜 */
  function nextRevision(threadID: string): number {
    const next = (runRevisions.get(threadID) ?? 0) + 1
    runRevisions.set(threadID, next)
    return next
  }

  /**
   * 跑一轮（`/runs` 与 `/runs/stream` 共用）。
   *
   * `onChunk` 只有流式端点传：图快照不属于会话事件流，非流式端点直接丢掉。
   */
  async function executeRun(
    threadID: string,
    payload: unknown,
    onChunk?: (mode: string, value: unknown) => void,
    presetRunID?: string,
    owner?: { clientID: string; revision: number }
  ): Promise<{ runID: string; status: 'success' | 'error'; message?: string }> {
    const runID = presetRunID ?? randomUUID()
    const controller = new AbortController()
    const startedAt = Date.now()
    activeRuns.set(threadID, {
      runID,
      controller,
      startedAt,
      clientID: owner?.clientID ?? '',
      revision: owner?.revision ?? 0
    })
    metrics?.inc('runs.started')
    logEvent?.('run.started', { threadID, runID, node: graphName })
    events?.emit(threadID, 'status', { phase: 'running', runID })

    let status: 'success' | 'error' = 'success'
    let message: string | undefined
    try {
      const streamable = await options.graph.stream(payload, {
        configurable: { thread_id: threadID },
        streamMode: ['values', 'updates']
      })
      // 只用 `AsyncIterable` 形态（不假设它是 generator），这样图换成别的实现也能跑
      const iterator = streamable[Symbol.asyncIterator]()
      const aborted = new Promise<never>(function (_resolve, reject) {
        controller.signal.addEventListener(
          'abort',
          function () {
            reject(new Error('run aborted'))
          },
          { once: true }
        )
      })
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted])
        if (next.done) break
        const parsed = toReadChunk(next.value)
        onChunk?.(parsed.mode, parsed.value)
      }
    } catch (error) {
      status = 'error'
      message = error instanceof Error ? error.message : String(error)
    } finally {
      // 只清理**自己这一轮**：`preempt` 等不到旧轮时，旧轮会在新轮登记之后才走到这里；
      // 无条件 delete / cancelThread 会把新轮的登记与待审批票据一起抹掉。
      const current = activeRuns.get(threadID)
      const ownsRun = current?.runID === runID
      if (ownsRun) activeRuns.delete(threadID)
      const durationMs = Date.now() - startedAt
      /**
       * 失败归因只算一次：结构化日志、计数器、回给前端的状态事件读同一个词。
       * 三处分头写正则迟早会漂成三种说法，排查时又要重新对齐。
       */
      const errorKind = status === 'error' ? classifyRunFailure(message) : null
      // 三种结局分开计数：`status=error` 里还要把「用户取消」拆出去，否则失败率永远偏高
      if (status === 'error') {
        if (errorKind === 'cancelled') metrics?.inc('runs.cancelled')
        else metrics?.inc('runs.failed')
      } else {
        metrics?.inc('runs.settled')
      }
      if (status === 'error') {
        // 单独的 run.failed 行：`run.settled` 里 success / error 混着，筛失败还要多写一步
        logEvent?.('run.failed', {
          threadID,
          runID,
          node: graphName,
          errorKind,
          durationMs,
          error: toErrorExcerpt(message)
        })
      }
      logEvent?.('run.settled', {
        threadID,
        runID,
        status,
        durationMs,
        node: graphName,
        ...(errorKind ? { errorKind } : {})
      })
      const thread = threads.get(threadID)
      if (thread) thread.updated_at = nowIso()
      // 回合已结束却还有待审批/待追问 → 这次不会再有人回执，按取消结掉避免永久挂起。
      // 只在「这轮仍是该 thread 的当前轮」时做；被抢占的旧轮不能结掉新轮的票据。
      if (ownsRun) {
        approvals?.cancelThread(threadID)
        elicitations?.cancelThread(threadID)
      }
      const statusEvent: {
        phase: string
        runID: string
        status: string
        message?: string
        /** 失败归因（`provider` / `tool` / `permission` / `connection` / `unknown`） */
        errorKind?: string
      } = { phase: 'settled', runID, status }
      if (message) statusEvent.message = message
      if (errorKind) statusEvent.errorKind = errorKind
      events?.emit(threadID, 'status', statusEvent)
    }
    return message === undefined ? { runID, status } : { runID, status, message }
  }

  /** 把请求体折成图的入参（`command.resume` 要包成 Command 实例）。 */
  function readRunPayload(body: unknown, threadID: string): unknown {
    const record = (body ?? {}) as { input?: unknown; command?: Record<string, unknown> }
    // resume 必须传 **Command 实例**：直接透传普通对象会被当成 input 更新，于是再次 interrupt。
    //
    // 注意这条分支在当前产品路径上是**预留**：`graph.ts` 只有一个 goose 节点、没有 `interrupt`，
    // 前端也从不发 `command`。它由 `checkpointer.test.ts` / `agent-server.sdk.test.ts` 用
    // `@langchain/langgraph-sdk` 的 `command: { resume }` 覆盖，保证「哪天加了 humanGate」时
    // 协议形状是对的。改动这里请同步那两个测试。
    return record.command !== undefined
      ? new Command(record.command as never)
      : withThreadID(record.input, threadID)
  }

  async function handleRunStream(req: Request, res: Response): Promise<void> {
    const threadID = toReadThreadID(req)
    const thread = ensureThread(threadID)
    if (!thread) {
      res.status(404).json({ error: 'thread_not_found' })
      return
    }

    // 流式端点与 `/runs` 同一套写者租约：先回 409，再决定要不要 flush headers
    const clientID = toReadClientID(req)
    const activeLease = activeRuns.get(threadID)
    if (activeLease && !canTakeWriterLease(activeLease, clientID, toReadTakeover(req.body))) {
      rejectWriterLease(res, activeLease)
      return
    }

    const validated = await normalizeRunInput(req.body, threadID)
    if (!validated.ok) {
      res.status(validated.status).json({ error: validated.code, message: validated.message })
      return
    }
    const payload = validated.payload

    res.status(200)
    res.setHeader('content-type', 'text/event-stream; charset=utf-8')
    res.setHeader('cache-control', 'no-cache, no-transform')
    res.setHeader('connection', 'keep-alive')
    res.flushHeaders()
    trackSse(res)

    // 流式端点也要单飞：否则同一线程上两轮交错写 checkpoint
    await preempt(threadID)

    const runID = randomUUID()
    const revision = nextRevision(threadID)
    writeSse(res, 'metadata', { run_id: runID, revision })

    let closed = false
    let finished = false
    res.on('close', function () {
      closed = true
      // 客户端断了但这一轮还在跑：继续跑等于烧 token、写文件，而没人看结果。
      // 与 `/threads/:id/cancel` 走同一条收尾路径（先 ACP cancel 收住长工具，再中止图）。
      if (finished) return
      void abortDisconnectedRun(threadID, runID)
    })

    const result = await executeRun(
      threadID,
      payload,
      function (mode, value) {
        if (closed) return
        writeSse(res, mode, value)
      },
      runID,
      { clientID, revision }
    )

    finished = true
    if (result.status === 'error' && result.message) {
      writeSse(res, 'error', { message: result.message })
    }
    const end: { status: string; message?: string } = { status: result.status }
    if (result.message) end.message = result.message
    writeSse(res, 'end', end)
    res.end()
  }

  /**
   * 流式端点的客户端断连收尾。
   *
   * 只把 `res` 关掉是不够的：图还在推进、goose 还在执行工具、checkpoint 还在写。
   * 这里只中止**这一条** run（`runID` 对得上才算），避免误杀之后新起的一轮。
   */
  async function abortDisconnectedRun(threadID: string, runID: string): Promise<void> {
    const active = activeRuns.get(threadID)
    if (!active || active.runID !== runID) return
    metrics?.inc('runs.disconnected')
    logEvent?.('run.disconnected', { threadID, runID })
    const sessionID = await readSessionID(threadID)
    if (sessionID && options.goose) {
      try {
        await options.goose.cancel(sessionID)
      } catch {
        // goose 已经没了 / 没在跑：继续掉图
      }
    }
    active.controller.abort()
  }

  /** 线程的真实运行态：有活跃轮就是 running（以前恒报 idle，前端只能靠事件流猜） */
  function readThreadStatus(threadID: string): 'running' | 'idle' {
    return activeRuns.has(threadID) ? 'running' : 'idle'
  }

  async function handleState(req: Request, res: Response): Promise<void> {
    const threadID = toReadThreadID(req)
    if (!ensureThread(threadID)) {
      res.status(404).json({ error: 'thread_not_found' })
      return
    }
    let values: unknown = {}
    let next: string[] = []
    if (options.graph.getState) {
      try {
        const state = (await options.graph.getState({ configurable: { thread_id: threadID } })) as
          | { values?: unknown; next?: readonly string[] }
          | undefined
        if (state) {
          values = state.values ?? {}
          next = [...(state.next ?? [])]
        }
      } catch (error) {
        // 图还没跑过时 getState 可能抛，按空状态返回；但要留痕，否则「状态总是空」无从查起
        console.warn(`[agent] 读取图状态失败（thread=${threadID}）:`, error)
      }
    }
    res.json({
      values,
      next,
      status: readThreadStatus(threadID),
      metadata: { source: 'loop' },
      created_at: nowIso()
    })
  }

  function trackSse(res: Response): void {
    SSEConnections.add(res)
    res.on('close', function () {
      SSEConnections.delete(res)
    })
  }

  /**
   * thread 登记上限：淘汰最久未用且没有活跃轮的线程。
   *
   * 客户端每次 run 前都会 `POST /threads` 幂等 upsert，所以淘汰不会丢持久数据；
   * 有活跃轮的线程一律不动，否则 `/threads/:id/*` 会突然 404。
   */
  function evictThreadIfNeeded(): boolean {
    if (threads.size < MAX_THREADS) return true
    let oldestID: string | null = null
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [id, thread] of threads) {
      if (activeRuns.has(id)) continue
      const at = Date.parse(thread.updated_at)
      if (Number.isFinite(at) && at < oldestAt) {
        oldestAt = at
        oldestID = id
      }
    }
    if (!oldestID) return false
    threads.delete(oldestID)
    sessions?.forgetThread(oldestID)
    return true
  }

  type NormalizedRun =
    | { ok: true; payload: unknown }
    | { ok: false; status: number; code: string; message: string }

  /**
   * run 输入的信任边界：`cwd` 必须是允许根内的现存目录，`mcpServers` 必须是
   * 已存在的绝对可执行文件。校验通过后把**归一化后的值**交给图，避免下游再信任原始输入。
   */
  async function normalizeRunInput(body: unknown, threadID: string): Promise<NormalizedRun> {
    const record = (body ?? {}) as { input?: unknown; command?: unknown }
    if (record.command !== undefined) {
      // resume 走 Command 实例，不是普通 input；形状由 SDK 测试守着
      return { ok: true, payload: readRunPayload(record, threadID) }
    }
    const input = record.input
    if (input === undefined || input === null) {
      return { ok: true, payload: withThreadID(undefined, threadID) }
    }
    if (typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, status: 400, code: 'input_invalid', message: 'input 必须是对象' }
    }
    const normalized = { ...(input as Record<string, unknown>) }

    if (normalized.cwd !== undefined) {
      const result = await validateCwd(normalized.cwd, limits?.allowedRoots ?? [])
      if (!result.ok) {
        return { ok: false, status: 400, code: result.code, message: result.message }
      }
      normalized.cwd = result.value
    }

    if (normalized.mcpServers !== undefined) {
      const result = await validateMcpServers(normalized.mcpServers, {
        allowedCommands: limits?.mcpAllowedCommands ?? [],
        allowBareCommand: limits?.allowBareMcpCommand ?? false,
        allowArbitraryCommand: limits?.allowArbitraryMcpCommand ?? false
      })
      if (!result.ok) {
        return { ok: false, status: 400, code: result.code, message: result.message }
      }
      normalized.mcpServers = result.value
    }

    return { ok: true, payload: { ...normalized, threadID } }
  }

  function mount(app: Express): void {
    const goose = options.goose ?? null

    /** 把 `_goose/unstable/*` 的读接口套成 GET；未就绪一律 503（前端据此显示「正在启动」而不是空白）。 */
    function gooseGet(path: string, method: string, params?: Record<string, unknown>): void {
      app.get(path, function (_req: Request, res: Response) {
        if (!goose) {
          res.status(503).json({ error: 'goose_unavailable' })
          return
        }
        goose.request(method, params ?? {}).then(
          function (result) {
            res.json(result ?? {})
          },
          function (error: unknown) {
            res.status(502).json({ error: 'goose_request_failed', message: String(error) })
          }
        )
      })
    }

    gooseGet('/goose/providers', '_goose/unstable/providers/list')
    gooseGet('/goose/extensions', '_goose/unstable/config/extensions/list')
    gooseGet('/goose/diagnostics', '_goose/unstable/diagnostics/get')
    gooseGet('/goose/defaults', '_goose/unstable/defaults/read')
    gooseGet('/goose/sessions', 'session/list')

    /**
     * 白名单透传：前端要用的 19 个 `_goose/unstable/*` 方法走这一条。
     *
     * `session/prompt` 与 `session/new` 刻意不在白名单里（前者必须走 `/runs` 才有单飞与
     * 事件流，后者有具名端点要跟 thread 绑定）。不在表里一律 403，不能让透传变成万能代理。
     */
    app.post('/goose/invoke', function (req: Request, res: Response) {
      if (!goose) {
        res.status(503).json({ error: 'goose_unavailable' })
        return
      }
      const body = (req.body ?? {}) as { method?: unknown; params?: unknown }
      const method = typeof body.method === 'string' ? body.method : ''
      if (!method) {
        res.status(400).json({ error: 'method_required' })
        return
      }
      if (!isAllowedGooseMethod(method)) {
        res.status(403).json({ error: 'method_not_allowed', method })
        return
      }
      goose.request(method, body.params ?? {}).then(
        function (result) {
          res.json(result ?? {})
        },
        function (error: unknown) {
          res.status(502).json({ error: 'goose_request_failed', message: String(error) })
        }
      )
    })

    app.post('/goose/sessions', async function (req: Request, res: Response) {
      if (!goose) {
        res.status(503).json({ error: 'goose_unavailable' })
        return
      }
      const body = (req.body ?? {}) as { cwd?: unknown; mcpServers?: unknown }
      const cwd = await validateCwd(body.cwd, limits?.allowedRoots ?? [])
      if (!cwd.ok) {
        res.status(400).json({ error: cwd.code, message: cwd.message })
        return
      }
      const servers = await validateMcpServers(body.mcpServers, {
        allowedCommands: limits?.mcpAllowedCommands ?? [],
        allowBareCommand: limits?.allowBareMcpCommand ?? false,
        allowArbitraryCommand: limits?.allowArbitraryMcpCommand ?? false
      })
      if (!servers.ok) {
        res.status(400).json({ error: servers.code, message: servers.message })
        return
      }
      goose
        .request('session/new', { cwd: cwd.value, mcpServers: servers.value })
        .then(
          function (result) {
            res.json(result ?? {})
          },
          function (error: unknown) {
            res.status(502).json({ error: 'goose_request_failed', message: String(error) })
          }
        )
    })

    app.post('/goose/sessions/:sessionId/mode', function (req: Request, res: Response) {
      if (!goose) {
        res.status(503).json({ error: 'goose_unavailable' })
        return
      }
      const body = (req.body ?? {}) as { modeId?: string }
      if (typeof body.modeId !== 'string' || body.modeId.length === 0) {
        res.status(400).json({ error: 'modeId_required' })
        return
      }
      // 权限档是 `configOptions` 里的一项（`configId: 'mode'`）；`session/set_mode` 是陷阱：
      // goose 会宽容返回 `{}` 但**不改状态**，于是“设了 approve 却仍然直接执行”。
      goose
        .request('session/set_config_option', {
          sessionId: toReadParam(req, 'sessionId'),
          configId: 'mode',
          value: body.modeId
        })
        .then(
          function (result) {
            res.json(result ?? {})
          },
          function (error: unknown) {
            res.status(502).json({ error: 'goose_request_failed', message: String(error) })
          }
        )
    })

    app.post('/goose/sessions/:sessionId/config', function (req: Request, res: Response) {
      if (!goose) {
        res.status(503).json({ error: 'goose_unavailable' })
        return
      }
      const body = (req.body ?? {}) as { configId?: unknown; value?: unknown }
      // 与 `/mode` 对齐：不认识的 configId 一律拒绝，不透传成「万能配置写口」
      if (!isAllowedSessionConfigID(body.configId)) {
        res.status(400).json({ error: 'config_id_not_allowed', configId: body.configId })
        return
      }
      goose
        .request('session/set_config_option', {
          sessionId: toReadParam(req, 'sessionId'),
          configId: body.configId,
          value: body.value
        })
        .then(
          function (result) {
            res.json(result ?? {})
          },
          function (error: unknown) {
            res.status(502).json({ error: 'goose_request_failed', message: String(error) })
          }
        )
    })

    app.post('/goose/sessions/:sessionId/cancel', function (req: Request, res: Response) {
      if (!goose) {
        res.status(503).json({ error: 'goose_unavailable' })
        return
      }
      const sessionId = toReadParam(req, 'sessionId')
      goose.cancel(sessionId).then(
        function () {
          res.status(202).json({ ok: true })
        },
        function (error: unknown) {
          res.status(502).json({ error: 'goose_cancel_failed', message: String(error) })
        }
      )
    })

    /**
     * 建线程；带 `thread_id` 时是**幂等 upsert**。
     *
     * 为什么必须允许客户端指定 id：`thread_id` 是 checkpoint 的主键。客户端用自己的本地会话 id
     * 才能做到「agentd 重启后接着跑」——随机 UUID 一重启就对不上历史了。
     */
    app.post('/threads', function (req: Request, res: Response) {
      const body = (req.body ?? {}) as { thread_id?: unknown; metadata?: Record<string, unknown> }
      const requested = typeof body.thread_id === 'string' ? body.thread_id.trim() : ''
      if (requested) {
        const checked = validateThreadID(requested)
        if (!checked.ok) {
          res.status(400).json({ error: checked.code, message: checked.message })
          return
        }
      }
      const threadID = requested || randomUUID()
      const existing = threads.get(threadID)
      if (existing) {
        existing.updated_at = nowIso()
        if (body.metadata) existing.metadata = body.metadata
        res.json({ ...existing, status: 'idle', values: {} })
        return
      }
      if (!evictThreadIfNeeded()) {
        res.status(429).json({ error: 'thread_limit_reached' })
        return
      }
      const thread: ThreadRecord = {
        thread_id: threadID,
        created_at: nowIso(),
        updated_at: nowIso(),
        metadata: body.metadata ?? {}
      }
      threads.set(threadID, thread)
      res.status(200).json({ ...thread, status: 'idle', values: {} })
    })

    app.get('/threads/:threadId', function (req: Request, res: Response) {
      const thread = ensureThread(toReadThreadID(req))
      if (!thread) {
        res.status(404).json({ error: 'thread_not_found' })
        return
      }
      res.json({ ...thread, status: readThreadStatus(thread.thread_id), values: {} })
    })

    app.get('/threads/:threadId/state', function (req: Request, res: Response) {
      void handleState(req, res)
    })

    app.post('/threads/:threadId/runs/stream', function (req: Request, res: Response) {
      void handleRunStream(req, res)
    })

    /**
     * 后台跑一轮，不挂 HTTP 响应：202 立刻返回，过程与结果全部进 `/threads/:id/events`。
     *
     * 前端用这条而不是 `/runs/stream`：一次会话的事件（正文增量、工具卡、审批、回合状态）
     * 不应该被绑在「一次图执行」的 HTTP 生命周期上。
     */
    app.post('/threads/:threadId/runs', function (req: Request, res: Response) {
      const threadID = toReadThreadID(req)
      const thread = ensureThread(threadID)
      if (!thread) {
        res.status(404).json({ error: 'thread_not_found' })
        return
      }
      const clientID = toReadClientID(req)
      const active = activeRuns.get(threadID)
      if (active && !canTakeWriterLease(active, clientID, toReadTakeover(req.body))) {
        rejectWriterLease(res, active)
        return
      }

      void (async function () {
        const validated = await normalizeRunInput(req.body, threadID)
        if (!validated.ok) {
          res.status(validated.status).json({ error: validated.code, message: validated.message })
          return
        }
        const runID = randomUUID()
        const revision = nextRevision(threadID)
        res.status(202).json({ run_id: runID, thread_id: threadID, revision })
        await preempt(threadID)
        await executeRun(threadID, validated.payload, undefined, runID, { clientID, revision })
      })()
    })

    /**
     * 取消当前轮。
     *
     * 两件事都要做：让 goose 停（ACP `session/cancel`，长工具只有它能真正收住）、
     * 中止图（否则 `graph.stream` 会继续把后续 update 写进事件流）。
     */
    app.post('/threads/:threadId/cancel', function (req: Request, res: Response) {
      const threadID = toReadThreadID(req)
      if (!ensureThread(threadID)) {
        res.status(404).json({ error: 'thread_not_found' })
        return
      }
      const active = activeRuns.get(threadID)
      if (!active) {
        res.status(200).json({ cancelled: false, reason: 'no_active_run' })
        return
      }
      res.status(202).json({ cancelled: true, run_id: active.runID })
      void (async function () {
        const sessionID = await readSessionID(threadID)
        if (sessionID && options.goose) {
          try {
            await options.goose.cancel(sessionID)
          } catch (error) {
            console.warn(`[agent] cancelling goose session 失败：${String(error)}`)
          }
        }
        active.controller.abort()
      })()
    })

    /**
     * 补历史：`session/load` 重放成一批 `replay` 事件（客户端按 `messageId` 替换正文）。
     * 只在没有活跃轮时可用；失败按旁路处理，不影响任何正在跑的东西。
     */
    app.post('/threads/:threadId/replay', function (req: Request, res: Response) {
      void handleReplay(req, res)
    })

    // ── 工具审批 ────────────────────────────────────────────────────────────
    // 审批不能用 LangGraph 的 interrupt：`session/request_permission` 是在 session/prompt
    // 还没返回时推上来的，打断节点就丢了那次 await。这里改成「挂住 ACP 回包 + 独立回执」。

    app.get('/threads/:threadId/approvals', function (req: Request, res: Response) {
      if (!approvals) {
        res.status(503).json({ error: 'approvals_unavailable' })
        return
      }
      res.json({ approvals: approvals.pending(toReadThreadID(req)) })
    })

    app.post('/threads/:threadId/approvals/:requestId', function (req: Request, res: Response) {
      if (!approvals) {
        res.status(503).json({ error: 'approvals_unavailable' })
        return
      }
      const body = (req.body ?? {}) as { optionId?: string | null; cancelled?: boolean }
      const optionId = body.cancelled === true ? null : (body.optionId ?? null)
      const result = approvals.settleFor(toReadThreadID(req), toReadParam(req, 'requestId'), optionId)
      if (result === 'not_found') {
        res.status(404).json({ error: 'approval_not_found' })
        return
      }
      if (result === 'invalid_option') {
        res.status(400).json({ error: 'invalid_option' })
        return
      }
      res.json({ ok: true, optionId })
    })

    // 结构化追问（`elicitation/create`）：与审批同一套「停下来等人」，只是回执形状不同。
    // 前端把表单填好后 POST 回来；`action` 只能是 accept / decline / cancel。
    app.get('/threads/:threadId/elicitations', function (req: Request, res: Response) {
      if (!elicitations) {
        res.status(503).json({ error: 'elicitations_unavailable' })
        return
      }
      res.json({ elicitations: elicitations.pending(toReadThreadID(req)) })
    })

    app.post('/threads/:threadId/elicitations/:requestId', function (req: Request, res: Response) {
      if (!elicitations) {
        res.status(503).json({ error: 'elicitations_unavailable' })
        return
      }
      const body = (req.body ?? {}) as {
        action?: unknown
        content?: Record<string, unknown>
      }
      const action =
        body.action === 'accept' || body.action === 'cancel' ? body.action : 'decline'
      const decision: ElicitationDecision =
        action === 'accept' ? { action: 'accept', content: body.content ?? {} } : { action }
      const settled = elicitations.settleFor(
        toReadThreadID(req),
        toReadParam(req, 'requestId'),
        decision
      )
      if (!settled) {
        res.status(404).json({ error: 'elicitation_not_found' })
        return
      }
      res.json({ ok: true, action })
    })

    /** 审批等事件的实时通道（SSE）。`/runs/stream` 只吐图状态，装不下这类外部事件。 */
    app.get('/threads/:threadId/events', function (req: Request, res: Response) {
      if (!events) {
        res.status(503).json({ error: 'events_unavailable' })
        return
      }
      const threadID = toReadThreadID(req)
      if (!ensureThread(threadID)) {
        res.status(404).json({ error: 'thread_not_found' })
        return
      }

      const parsedAfter = parseAfterQuery(req.query.after)
      if (!parsedAfter.ok) {
        res.status(400).json({ error: parsedAfter.code, message: parsedAfter.message })
        return
      }
      const parsedEpoch = validateEpoch(req.query.epoch)
      if (!parsedEpoch.ok) {
        res.status(400).json({ error: parsedEpoch.code, message: parsedEpoch.message })
        return
      }
      const after = parsedAfter.value
      const requestedEpoch = parsedEpoch.value

      metrics?.inc('events.sse.connections')

      res.status(200)
      res.setHeader('content-type', 'text/event-stream; charset=utf-8')
      res.setHeader('cache-control', 'no-cache, no-transform')
      res.setHeader('connection', 'keep-alive')
      res.flushHeaders()
      trackSse(res)

      // 先订阅、再补发：反过来的话，「取快照 → 挂订阅」之间产生的事件既不在补发里，
      // 也没有订阅者接住 —— 前端会永久缺一段正文，而 `sync` 又告诉它「你已经是最新的」。
      // 补发与实时尾部会重叠，所以写出口统一按 `seq` 去重。
      //
      // 游标初值必须是 0 而**不是** `after`：同进程内 seq 持续递增，但重连时服务端会先把
      // `seq > after` 的补发写出来，`lastWritten` 自然推进到补发末尾。初始化为 `after` 反而
      // 会让「同 seq 的实时尾部」被误判成已写过。
      let lastWritten = 0
      let replaying = true
      const queued: RunEvent[] = []
      function send(event: RunEvent): void {
        if (event.seq <= lastWritten) return
        lastWritten = event.seq
        writeSse(res, 'run', event)
      }
      const unsubscribe = events.subscribe(threadID, function (event) {
        if (replaying) {
          queued.push(event)
          return
        }
        send(event)
      })

      // 先按游标从持久日志补发，再发一份「现状」：审批请求可能发生在连上来之前
      const replay = events.replay(threadID, after, requestedEpoch)
      if (after !== undefined && replay.events.length > 0) {
        // 「补发了几次」是断流频率的直接度量：值高说明前端在反复重连，而不是网络偶发
        metrics?.inc('events.cursor.replays')
        logEvent?.('events.replay', { threadID, from: after, count: replay.events.length })
      }
      if (replay.truncated) {
        logEvent?.('events.replay.truncated', { threadID, from: after ?? 0, minSeq: replay.minSeq })
      }
      for (const event of replay.events) {
        send(event)
      }
      // `lastSeq` 必须是**已经写到这条连接上**的位置，不是服务端最新：
      // 报大了会让前端下次从中间开始取，安静地跳过一段正文。
      writeSse(res, 'sync', {
        epoch: replay.epoch,
        lastSeq: lastWritten,
        minSeq: replay.minSeq,
        truncated: replay.truncated,
        reset: replay.reset,
        approvals: approvals ? approvals.pending(threadID) : [],
        elicitations: elicitations ? elicitations.pending(threadID) : []
      })
      replaying = false
      for (const event of queued) {
        send(event)
      }
      res.on('close', function () {
        unsubscribe()
      })
    })
  }

  return {
    name: 'self',
    mount,
    graphs: function (): readonly string[] {
      return [graphName]
    },
    closeConnections: function (): void {
      for (const res of SSEConnections) {
        try {
          res.end()
        } catch {
          // 已经断开
        }
      }
      SSEConnections.clear()
    },
    stop: async function (): Promise<void> {
      for (const res of SSEConnections) {
        try {
          res.end()
        } catch {
          // 已经断开
        }
      }
      SSEConnections.clear()
      threads.clear()
      sessions?.clear()
    }
  }
}

export { createAgentServer }
