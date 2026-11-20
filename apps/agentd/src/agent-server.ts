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
}

interface GooseQueryPort {
  request(method: string, params?: unknown): Promise<unknown>
  cancel(sessionId: string): Promise<void>
}

interface AgentServer {
  readonly name: string
  mount(app: Express): void
  graphs(): readonly string[]
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
}

/** 抢占旧轮时等它落地的上限：超过就继续开新的（宁可丢旧轮，也不要卡在发送中）。 */
const PREEMPT_WAIT_MS = 1500
const PREEMPT_POLL_MS = 50

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
function readChunk(chunk: unknown): { mode: string; value: unknown } {
  if (Array.isArray(chunk) && chunk.length === 2 && typeof chunk[0] === 'string') {
    return { mode: chunk[0], value: chunk[1] }
  }
  return { mode: 'values', value: chunk }
}

function createAgentServer(options: AgentServerOptions): AgentServer {
  const graphName = options.graphName ?? GRAPH_NAME
  const threads = new Map<string, ThreadRecord>()
  const activeRuns = new Map<string, ActiveRun>()
  const approvals = options.approvals ?? null
  const elicitations = options.elicitations ?? null
  const events = options.events ?? null
  const metrics = options.metrics ?? null
  const logEvent = options.logEvent ?? null

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
      event.type === 'approval_requested' ? 'approval' : 'status',
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
      event.type === 'elicitation_requested' ? 'elicitation' : 'status',
      event
    )
  })

  function readThreadID(req: Request): string {
    return String(req.params.threadId ?? '')
  }

  /** 任意路由参数（goose 那组用 `:sessionId`，没有 thread 语义）。 */
  function readParam(req: Request, name: string): string {
    return String((req.params as Record<string, unknown>)[name] ?? '')
  }

  function ensureThread(threadID: string): ThreadRecord | null {
    return threads.get(threadID) ?? null
  }

  /** 图状态里的 `sessionId`（取消时要拿它发 ACP cancel）；拿不到就返回 null。 */
  async function readSessionID(threadID: string): Promise<string | null> {
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

  /**
   * 跑一轮（`/runs` 与 `/runs/stream` 共用）。
   *
   * `onChunk` 只有流式端点传：图快照不属于会话事件流，非流式端点直接丢掉。
   */
  async function executeRun(
    threadID: string,
    payload: unknown,
    onChunk?: (mode: string, value: unknown) => void,
    presetRunID?: string
  ): Promise<{ runID: string; status: 'success' | 'error'; message?: string }> {
    const runID = presetRunID ?? randomUUID()
    const controller = new AbortController()
    const startedAt = Date.now()
    activeRuns.set(threadID, { runID, controller, startedAt })
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
        const parsed = readChunk(next.value)
        onChunk?.(parsed.mode, parsed.value)
      }
    } catch (error) {
      status = 'error'
      message = error instanceof Error ? error.message : String(error)
    } finally {
      activeRuns.delete(threadID)
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
      // 回合已结束却还有待审批/待追问 → 这次不会再有人回执，按取消结掉避免永久挂起
      approvals?.cancelThread(threadID)
      elicitations?.cancelThread(threadID)
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
  function readRunPayload(req: Request, threadID: string): unknown {
    const body = (req.body ?? {}) as { input?: unknown; command?: Record<string, unknown> }
    // resume 必须传 **Command 实例**：直接透传普通对象会被当成 input 更新，于是再次 interrupt。
    //
    // 注意这条分支在当前产品路径上是**预留**：`graph.ts` 只有一个 goose 节点、没有 `interrupt`，
    // 前端也从不发 `command`。它由 `checkpointer.test.ts` / `agent-server.sdk.test.ts` 用
    // `@langchain/langgraph-sdk` 的 `command: { resume }` 覆盖，保证「哪天加了 humanGate」时
    // 协议形状是对的。改动这里请同步那两个测试。
    return body.command !== undefined
      ? new Command(body.command as never)
      : withThreadID(body.input, threadID)
  }

  async function handleRunStream(req: Request, res: Response): Promise<void> {
    const threadID = readThreadID(req)
    const thread = ensureThread(threadID)
    if (!thread) {
      res.status(404).json({ error: 'thread_not_found' })
      return
    }

    const payload = readRunPayload(req, threadID)

    res.status(200)
    res.setHeader('content-type', 'text/event-stream; charset=utf-8')
    res.setHeader('cache-control', 'no-cache, no-transform')
    res.setHeader('connection', 'keep-alive')
    res.flushHeaders()

    // 流式端点也要单飞：否则同一线程上两轮交错写 checkpoint
    await preempt(threadID)

    const runID = randomUUID()
    writeSse(res, 'metadata', { run_id: runID })

    let closed = false
    res.on('close', function () {
      closed = true
    })

    const result = await executeRun(
      threadID,
      payload,
      function (mode, value) {
        if (closed) return
        writeSse(res, mode, value)
      },
      runID
    )

    if (result.status === 'error' && result.message) {
      writeSse(res, 'error', { message: result.message })
    }
    const end: { status: string; message?: string } = { status: result.status }
    if (result.message) end.message = result.message
    writeSse(res, 'end', end)
    res.end()
  }

  async function handleState(req: Request, res: Response): Promise<void> {
    const threadID = readThreadID(req)
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
      } catch {
        // 图还没跑过时 getState 可能抛，按空状态返回
      }
    }
    res.json({ values, next, metadata: { source: 'loop' }, created_at: nowIso() })
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

    app.post('/goose/sessions', function (req: Request, res: Response) {
      if (!goose) {
        res.status(503).json({ error: 'goose_unavailable' })
        return
      }
      const body = (req.body ?? {}) as { cwd?: string; mcpServers?: unknown[] }
      if (typeof body.cwd !== 'string' || body.cwd.length === 0) {
        res.status(400).json({ error: 'cwd_required' })
        return
      }
      goose
        .request('session/new', { cwd: body.cwd, mcpServers: body.mcpServers ?? [] })
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
          sessionId: readParam(req, 'sessionId'),
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
      const body = (req.body ?? {}) as { configId?: string; value?: unknown }
      goose
        .request('session/set_config_option', {
          sessionId: readParam(req, 'sessionId'),
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
      const sessionId = readParam(req, 'sessionId')
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
      const threadID = requested || randomUUID()
      const existing = threads.get(threadID)
      if (existing) {
        existing.updated_at = nowIso()
        if (body.metadata) existing.metadata = body.metadata
        res.json({ ...existing, status: 'idle', values: {} })
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
      const thread = ensureThread(readThreadID(req))
      if (!thread) {
        res.status(404).json({ error: 'thread_not_found' })
        return
      }
      res.json({ ...thread, status: 'idle', values: {} })
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
      const threadID = readThreadID(req)
      const thread = ensureThread(threadID)
      if (!thread) {
        res.status(404).json({ error: 'thread_not_found' })
        return
      }

      const payload = readRunPayload(req, threadID)
      const runID = randomUUID()
      res.status(202).json({ run_id: runID, thread_id: threadID })

      void (async function () {
        await preempt(threadID)
        await executeRun(threadID, payload, undefined, runID)
      })()
    })

    /**
     * 取消当前轮。
     *
     * 两件事都要做：让 goose 停（ACP `session/cancel`，长工具只有它能真正收住）、
     * 中止图（否则 `graph.stream` 会继续把后续 update 写进事件流）。
     */
    app.post('/threads/:threadId/cancel', function (req: Request, res: Response) {
      const threadID = readThreadID(req)
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

    // ── 工具审批 ────────────────────────────────────────────────────────────
    // 审批不能用 LangGraph 的 interrupt：`session/request_permission` 是在 session/prompt
    // 还没返回时推上来的，打断节点就丢了那次 await。这里改成「挂住 ACP 回包 + 独立回执」。

    app.get('/threads/:threadId/approvals', function (req: Request, res: Response) {
      if (!approvals) {
        res.status(503).json({ error: 'approvals_unavailable' })
        return
      }
      res.json({ approvals: approvals.pending(readThreadID(req)) })
    })

    app.post('/threads/:threadId/approvals/:requestId', function (req: Request, res: Response) {
      if (!approvals) {
        res.status(503).json({ error: 'approvals_unavailable' })
        return
      }
      const body = (req.body ?? {}) as { optionId?: string | null; cancelled?: boolean }
      const optionId = body.cancelled === true ? null : (body.optionId ?? null)
      const settled = approvals.settle(readParam(req, 'requestId'), optionId)
      if (!settled) {
        res.status(404).json({ error: 'approval_not_found' })
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
      res.json({ elicitations: elicitations.pending(readThreadID(req)) })
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
      const settled = elicitations.settle(readParam(req, 'requestId'), decision)
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
      const threadID = readThreadID(req)
      if (!ensureThread(threadID)) {
        res.status(404).json({ error: 'thread_not_found' })
        return
      }

      const rawAfter = Number(req.query.after)
      const after = Number.isFinite(rawAfter) ? rawAfter : undefined

      metrics?.inc('events.sse.connections')

      res.status(200)
      res.setHeader('content-type', 'text/event-stream; charset=utf-8')
      res.setHeader('cache-control', 'no-cache, no-transform')
      res.setHeader('connection', 'keep-alive')
      res.flushHeaders()

      // 先订阅、再补发：反过来的话，「取快照 → 挂订阅」之间产生的事件既不在补发里，
      // 也没有订阅者接住 —— 前端会永久缺一段正文，而 `sync` 又告诉它「你已经是最新的」。
      // 补发与实时尾部会重叠，所以写出口统一按 `seq` 去重。
      //
      // 游标初值必须是 0 而**不是** `after`：`seq` 是本进程内的内存计数器，agentd 重启后
      // 从头开始，而前端手里还留着上一个进程的大游标。若以 `after` 初始化，`send()` 会把
      // 新进程的每一条事件都判成「已写过」丢掉 —— 前端表现为「重试后一直思考中、零输出」，
      // 直到一轮的空闲上限（60 分钟）才报超时。补发本身已由 `since(after)` 过滤过，
      // 从 0 起算不会重复写。
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

      // 先按游标补发，再发一份「现状」：审批请求可能发生在连上来之前
      const missed = events.since(threadID, after)
      if (after !== undefined && missed.length > 0) {
        // 「补发了几次」是断流频率的直接度量：值高说明前端在反复重连，而不是网络偶发
        metrics?.inc('events.cursor.replays')
        logEvent?.('events.replay', { threadID, from: after, count: missed.length })
      }
      for (const event of missed) {
        send(event)
      }
      // `lastSeq` 必须是**已经写到这条连接上**的位置，不是服务端最新：
      // 报大了会让前端下次从中间开始取，安静地跳过一段正文。
      writeSse(res, 'sync', {
        approvals: approvals ? approvals.pending(threadID) : [],
        elicitations: elicitations ? elicitations.pending(threadID) : [],
        lastSeq: lastWritten
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
    stop: async function (): Promise<void> {
      threads.clear()
    }
  }
}

export { GRAPH_NAME, createAgentServer, readChunk, writeSse }
export type { AgentServer, AgentServerOptions, CompiledGraphLike }
