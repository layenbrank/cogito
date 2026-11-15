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
import type { EventHub } from './events'

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
  /** 会话事件流（`session/update` 与审批）；为 null 时 `/threads/:id/events` 一律 503 */
  events?: EventHub | null
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
  const approvals = options.approvals ?? null
  const events = options.events ?? null

  // 审批事件汇进同一条流：前端只消费 `/threads/:id/events` 一个通道
  approvals?.subscribe(function (event) {
    events?.emit(
      event.approval.threadID,
      event.type === 'approval_requested' ? 'approval' : 'status',
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

  /** 把请求体折成图的入参（`command.resume` 要包成 Command 实例）。 */
  function readRunPayload(req: Request, threadID: string): unknown {
    const body = (req.body ?? {}) as { input?: unknown; command?: Record<string, unknown> }
    // resume 必须传 **Command 实例**：直接透传普通对象会被当成 input 更新，于是再次 interrupt
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

    const runID = randomUUID()
    writeSse(res, 'metadata', { run_id: runID })
    let status: 'success' | 'error' = 'success'
    let message: string | undefined

    let aborted = false
    res.on('close', function () {
      aborted = true
    })

    try {
      const iterator = await options.graph.stream(payload, {
        configurable: { thread_id: threadID },
        streamMode: ['values', 'updates']
      })
      for await (const chunk of iterator) {
        if (aborted) break
        const parsed = readChunk(chunk)
        writeSse(res, parsed.mode, parsed.value)
      }
    } catch (error) {
      status = 'error'
      message = error instanceof Error ? error.message : String(error)
      writeSse(res, 'error', { message })
    } finally {
      thread.updated_at = nowIso()
      // run 已经结束却还有待审批 → 这次回合不会再用到它，按取消结掉避免永久挂起
      approvals?.cancelThread(threadID)
      const end: { status: string; message?: string } = { status }
      if (message) end.message = message
      writeSse(res, 'end', end)
      res.end()
    }
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

    app.post('/threads', function (req: Request, res: Response) {
      const body = (req.body ?? {}) as { metadata?: Record<string, unknown> }
      const thread: ThreadRecord = {
        thread_id: randomUUID(),
        created_at: nowIso(),
        updated_at: nowIso(),
        metadata: body.metadata ?? {}
      }
      threads.set(thread.thread_id, thread)
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
        events?.emit(threadID, 'status', { phase: 'running', runID })
        let status: 'success' | 'error' = 'success'
        let message: string | undefined
        try {
          const iterator = await options.graph.stream(payload, {
            configurable: { thread_id: threadID },
            streamMode: ['values', 'updates']
          })
          // 图快照不进事件流（前端要的是会话事件）；这里只把流跑完
          for await (const _chunk of iterator) {
            // drain
          }
        } catch (error) {
          status = 'error'
          message = error instanceof Error ? error.message : String(error)
        } finally {
          thread.updated_at = nowIso()
          approvals?.cancelThread(threadID)
          const statusEvent: { phase: string; runID: string; status: string; message?: string } = {
            phase: 'settled',
            runID,
            status
          }
          if (message) statusEvent.message = message
          events?.emit(threadID, 'status', statusEvent)
        }
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

      res.status(200)
      res.setHeader('content-type', 'text/event-stream; charset=utf-8')
      res.setHeader('cache-control', 'no-cache, no-transform')
      res.setHeader('connection', 'keep-alive')
      res.flushHeaders()

      // 先按游标补发，再发一份「现状」：审批请求可能发生在连上来之前
      for (const event of events.since(threadID, after)) {
        writeSse(res, 'run', event)
      }
      writeSse(res, 'sync', {
        approvals: approvals ? approvals.pending(threadID) : [],
        lastSeq: events.since(threadID).at(-1)?.seq ?? 0
      })

      const unsubscribe = events.subscribe(threadID, function (event) {
        writeSse(res, 'run', event)
      })
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
