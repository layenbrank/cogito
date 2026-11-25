/**
 * goose ACP client（stdio）。
 *
 * 与 Rust 侧现行实现保持同一套语义（见 `goose_serve.rs`）：
 * - 环境必须与 Tauri 注入的一致：`GOOSE_PATH_ROOT` 指向 `<appData>/goose`，
 *   否则 `custom_providers` / `cogito/jwt` / token-helper 全部失效；
 * - **`session/new` 在创建时就要能解析 provider + model**（S3 实测：否则 -32603），
 *   所以 supervisor 必须等到 provider 可解析才对外报 ready；
 * - `session/update` 是通知，按 `sessionId` 过滤；`session/prompt` 的响应代表本回合结束。
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { createLineSplitter, isIncomingRequest, parseMessage } from './protocol'
import type { JsonRpcId, JsonRpcRequest } from './protocol'

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

interface GooseAcpOptions {
  binary: string
  args?: readonly string[]
  env?: NodeJS.ProcessEnv
  cwd?: string
  onStderr?: (text: string) => void
  onExit?: (code: number | null, reason?: string) => void
  requestTimeoutMs?: number
}

interface AgentCapabilities {
  loadSession?: boolean
  sessionCapabilities?: Record<string, unknown>
  promptCapabilities?: Record<string, unknown>
  mcpCapabilities?: Record<string, unknown>
}

interface InitializeResult {
  protocolVersion: number
  agentCapabilities: AgentCapabilities
  agentInfo?: { name?: string; version?: string }
  authMethods?: readonly unknown[]
}

interface NewSessionResult {
  sessionId: string
  modes?: { currentModeId?: string; availableModes?: readonly unknown[] }
  configOptions?: readonly unknown[]
}

interface GooseAcpClient {
  readonly pid: number | undefined
  initialize(): Promise<InitializeResult>
  newSession(params: { cwd: string; mcpServers?: readonly unknown[] }): Promise<NewSessionResult>
  prompt(sessionId: string, text: string): Promise<unknown>
  cancel(sessionId: string): Promise<void>
  /** 透传任意 ACP 方法（`_goose/unstable/*` 与 `session/list` 这类查询面） */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>
  onSessionUpdate(listener: (sessionId: string, update: unknown) => void): () => void
  /**
   * `session/request_permission` 的处理器。
   *
   * **未注册 = 一律取消**（fail-closed）：审批是安全闸门，没有人在听时宁可不执行。
   */
  onPermissionRequest(listener: PermissionRequestHandler | null): void
  /**
   * `elicitation/create` 的处理器（结构化追问）。
   *
   * **未注册 = 一律 decline**（fail-closed）：没人在听时不要让 goose 卡在等人填表上。
   */
  onElicitationRequest(listener: ElicitationRequestHandler | null): void
  close(): void
}

interface PermissionChoice {
  optionId: string
  name: string
  kind: string
}

interface PermissionPrompt {
  sessionId: string
  toolCall: unknown
  options: PermissionChoice[]
}

/** `null` = 用户取消（goose 会把这一步标记为未授权）。 */
type PermissionDecision = { optionId: string } | null

type PermissionRequestHandler = (prompt: PermissionPrompt) => Promise<PermissionDecision>

/** `elicitation/create` 的参数（form 模式）。 */
interface ElicitationPrompt {
  sessionId: string
  mode: 'form' | 'url'
  message: string
  requestedSchema: unknown
  url?: string
}

type ElicitationDecision =
  | { action: 'accept'; content?: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' }

type ElicitationRequestHandler = (prompt: ElicitationPrompt) => Promise<ElicitationDecision>

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

function sessionIdOf(params: unknown): string | null {
  if (typeof params !== 'object' || params === null) return null
  const value = (params as Record<string, unknown>).sessionId
  return typeof value === 'string' ? value : null
}

function spawnGooseAcp(options: GooseAcpOptions): GooseAcpClient {
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const child: ChildProcessWithoutNullStreams = spawn(
    options.binary,
    [...(options.args ?? ['acp', '--with-builtin', 'developer'])],
    {
      cwd: options.cwd,
      env: options.env,
      // Windows：不弹黑窗；stdio 全 pipe
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )

  const pending = new Map<JsonRpcId, PendingRequest>()
  const updateListeners = new Set<(sessionId: string, update: unknown) => void>()
  const splitter = createLineSplitter()
  let permissionHandler: PermissionRequestHandler | null = null
  let elicitationHandler: ElicitationRequestHandler | null = null
  let nextId = 1
  let closed = false
  /** `onExit` 只报一次：`error` 与 `exit` 可能先后到达 */
  let reportedExit = false

  function rejectPending(error: Error): void {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    pending.clear()
  }

  function reportExit(code: number | null, reason?: string): void {
    if (reportedExit) return
    reportedExit = true
    options.onExit?.(code, reason)
  }

  /**
   * 子进程错误（spawn 失败 / EPIPE / 管道被关）：
   *
   * Node 对未监听的 `'error'` 事件会直接抛成未捕获异常，把整个 agentd 带走。
   * 所以所有错误统一折算成「本次 client 已死」：拒绝 pending、只报一次 exit，
   * 由 supervisor 决定是否重启。
   */
  function fail(reason: string): void {
    if (closed) return
    closed = true
    console.error(`[acp] ${reason}`)
    rejectPending(new Error(`goose acp ${reason}`))
    reportExit(null, reason)
  }

  /** 写 stdin：进程可能刚死但 `exit` 还没派发，写前要自己拦 */
  function safeWrite(payload: unknown): boolean {
    if (closed || child.stdin.destroyed || child.stdin.writableEnded) return false
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
      return true
    } catch (error) {
      fail(`stdin 写入失败：${String(error)}`)
      return false
    }
  }

  /** 把决定写回给 goose；请求方在等这条 result。 */
  function respondPermission(requestId: JsonRpcId, decision: PermissionDecision): void {
    if (closed) return
    const result = decision
      ? { outcome: { outcome: 'selected', optionId: decision.optionId } }
      : { outcome: { outcome: 'cancelled' } }
    console.log(`[acp] 审批回执 id=${requestId} → ${JSON.stringify(result.outcome)}`)
    safeWrite({ jsonrpc: '2.0', id: requestId, result })
  }

  /**
   * `elicitation/create`：goose 想让人填一张表。
   *
   * 与审批的关键区别是**回执形状**：审批回 `{outcome:{outcome,optionId}}`，追问回
   * `{action, content?}`。未注册处理器时按 `decline` 结案（不是 `cancel`）：decline 表示
   * 「这次不填，你自己想办法」，cancel 更像「用户主动中止」，前者对长任务更友好。
   */
  async function handleElicitation(id: JsonRpcId, params: unknown): Promise<void> {
    const record = (typeof params === 'object' && params !== null ? params : {}) as Record<
      string,
      unknown
    >
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
    const mode = record.mode === 'url' ? 'url' : 'form'
    const message = typeof record.message === 'string' ? record.message : ''

    function respond(decision: ElicitationDecision): void {
      if (closed) return
      // `accept` 必须带 `content`（哪怕空对象），否则 goose 侧解析会把它当非法结果
      const result =
        decision.action === 'accept'
          ? { action: 'accept', content: decision.content ?? {} }
          : { action: decision.action }
      console.log(`[acp] 追问回执 id=${id} → ${decision.action}`)
      safeWrite({ jsonrpc: '2.0', id, result })
    }

    if (!elicitationHandler || mode !== 'form') {
      // url 模式我们还不支持（没有浏览器交互面）：直接 decline，别让 goose 干等
      console.log(`[acp] elicitation/create 未处理（mode=${mode}）→ decline`)
      respond({ action: 'decline' })
      return
    }

    console.log(`[acp] elicitation/create id=${id} session=${sessionId}`)
    try {
      const decision = await elicitationHandler({
        sessionId,
        mode,
        message,
        requestedSchema: record.requestedSchema,
        ...(typeof record.url === 'string' ? { url: record.url } : {})
      })
      respond(decision)
    } catch (error) {
      console.warn(`[acp] 追问处理器出错，按 decline 结案：${String(error)}`)
      respond({ action: 'decline' })
    }
  }

  async function handleIncomingRequest(
    method: string,
    id: JsonRpcId,
    params: unknown
  ): Promise<void> {
    if (method === 'elicitation/create') {
      await handleElicitation(id, params)
      return
    }

    if (method !== 'session/request_permission') {
      // 未实现的反向请求必须回错，不能让它悬着
      safeWrite({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `未实现的客户端方法: ${method}` }
      })
      return
    }

    const record = (typeof params === 'object' && params !== null ? params : {}) as Record<
      string,
      unknown
    >
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
    const options = Array.isArray(record.options) ? record.options : []
    const choices = options
      .map(function (option) {
        if (typeof option !== 'object' || option === null) return null
        const item = option as Record<string, unknown>
        if (typeof item.optionId !== 'string') return null
        return {
          optionId: item.optionId,
          name: typeof item.name === 'string' ? item.name : item.optionId,
          kind: typeof item.kind === 'string' ? item.kind : 'unknown'
        }
      })
      .filter(function (choice): choice is PermissionChoice {
        return choice !== null
      })

    if (!permissionHandler) {
      // fail-closed：没有人在听就不执行
      console.log(`[acp] ${method} 到达但未注册处理器，按取消回写`)
      respondPermission(id, null)
      return
    }

    console.log(`[acp] ${method} id=${id} session=${sessionId} options=${choices.length}`)
    try {
      const decision = await permissionHandler({
        sessionId,
        toolCall: record.toolCall,
        options: choices
      })
      respondPermission(id, decision)
    } catch {
      respondPermission(id, null)
    }
  }

  child.on('error', function (error: Error) {
    // spawn 失败（ENOENT / EACCES）会走到这里；不监听就是未捕获异常
    fail(`启动/运行失败：${error.message}`)
  })

  child.stdin.on('error', function (error: Error) {
    // goose 刚死、exit 还没派发时写 stdin 会得到 EPIPE
    fail(`stdin 错误：${error.message}`)
  })

  child.stdout.on('error', function (error: Error) {
    fail(`stdout 错误：${error.message}`)
  })

  child.stderr.on('error', function (error: Error) {
    // stderr 坏了不影响协议，但值得记一笔
    console.warn(`[acp] stderr 错误：${error.message}`)
  })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', function (chunk: string) {
    for (const line of splitter.push(chunk)) {
      const message = parseMessage(line)
      if (!message) continue
      if (isIncomingRequest(message)) {
        void handleIncomingRequest(message.method, message.id, message.params)
        continue
      }
      if ('method' in message) {
        if (message.method === 'session/update') {
          const sessionId = sessionIdOf(message.params)
          const update =
            typeof message.params === 'object' && message.params !== null
              ? (message.params as Record<string, unknown>).update
              : undefined
          if (sessionId) {
            for (const listener of updateListeners) listener(sessionId, update)
          }
        } else {
          // 认不出但不能默默丢：丢掉一条反向请求 = goose 一直在等
          console.log(`[acp] 其他帧 method=${message.method}`)
        }
        continue
      }
      const waiter = pending.get(message.id)
      if (!waiter) continue
      pending.delete(message.id)
      clearTimeout(waiter.timer)
      if (message.error) {
        waiter.reject(
          new Error(`ACP ${message.error.code}: ${message.error.message}`)
        )
        continue
      }
      waiter.resolve(message.result)
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', function (chunk: string) {
    options.onStderr?.(chunk)
  })

  child.on('exit', function (code) {
    if (closed) {
      // `fail()` / `close()` 已经处理过：pending 不会再有回包
      if (!reportedExit) reportExit(code)
      return
    }
    closed = true
    rejectPending(new Error('goose acp 已退出'))
    reportExit(code)
  })

  function request(method: string, params: unknown, timeoutOverride?: number): Promise<unknown> {
    if (closed) return Promise.reject(new Error('goose acp 未运行'))
    const id = nextId++
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        pending.delete(id)
        reject(new Error(`ACP ${method} 超时`))
      }, timeoutOverride ?? timeoutMs)
      timer.unref()
      pending.set(id, { resolve, reject, timer })
      if (!safeWrite(payload)) {
        pending.delete(id)
        clearTimeout(timer)
        reject(new Error('goose acp 未运行'))
      }
    })
  }

  function notify(method: string, params: unknown): void {
    safeWrite({ jsonrpc: '2.0', method, params })
  }

  return {
    pid: child.pid,
    initialize: function (): Promise<InitializeResult> {
      return request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false
        },
        clientInfo: { name: 'cogito-agentd', version: '0.0.0' }
      }).then(function (result) {
        return result as InitializeResult
      })
    },
    newSession: function (params): Promise<NewSessionResult> {
      return request('session/new', {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? []
      }).then(function (result) {
        const value = result as NewSessionResult
        if (!value || typeof value.sessionId !== 'string') {
          throw new Error('session/new 未返回 sessionId')
        }
        return value
      })
    },
    prompt: function (sessionId: string, text: string): Promise<unknown> {
      // 一轮可能很久（模型 + 工具），单独放宽超时
      return request(
        'session/prompt',
        { sessionId, prompt: [{ type: 'text', text }] },
        30 * 60_000
      )
    },
    cancel: async function (sessionId: string): Promise<void> {
      // cancel 是通知，不等响应
      notify('session/cancel', { sessionId })
    },
    request: function (
      method: string,
      params?: unknown,
      timeoutMsOverride?: number
    ): Promise<unknown> {
      return request(method, params ?? {}, timeoutMsOverride)
    },
    onSessionUpdate: function (listener): () => void {
      updateListeners.add(listener)
      return function () {
        updateListeners.delete(listener)
      }
    },
    onPermissionRequest: function (listener: PermissionRequestHandler | null): void {
      permissionHandler = listener
    },
    onElicitationRequest: function (listener: ElicitationRequestHandler | null): void {
      elicitationHandler = listener
    },
    close: function (): void {
      closed = true
      try {
        child.stdin.end()
      } catch {
        // 已经关掉了
      }
      try {
        child.kill()
      } catch {
        // spawn 失败过的 child 没有可杀进程
      }
    }
  }
}

export { spawnGooseAcp }
export type {
  AgentCapabilities,
  ElicitationDecision,
  ElicitationPrompt,
  ElicitationRequestHandler,
  GooseAcpClient,
  GooseAcpOptions,
  InitializeResult,
  NewSessionResult,
  PermissionChoice,
  PermissionDecision,
  PermissionPrompt,
  PermissionRequestHandler
}
