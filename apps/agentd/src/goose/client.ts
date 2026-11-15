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
  onExit?: (code: number | null) => void
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
  let nextId = 1
  let closed = false

  /** 把决定写回给 goose；请求方在等这条 result。 */
  function respondPermission(requestId: JsonRpcId, decision: PermissionDecision): void {
    if (closed) return
    const result = decision
      ? { outcome: { outcome: 'selected', optionId: decision.optionId } }
      : { outcome: { outcome: 'cancelled' } }
    console.log(`[acp] 审批回执 id=${requestId} → ${JSON.stringify(result.outcome)}`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, result })}\n`)
  }

  async function handleIncomingRequest(
    method: string,
    id: JsonRpcId,
    params: unknown
  ): Promise<void> {
    if (method !== 'session/request_permission') {
      // 未实现的反向请求必须回错，不能让它悬着
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `未实现的客户端方法: ${method}` }
        })}\n`
      )
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
    closed = true
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('goose acp 已退出'))
    }
    pending.clear()
    options.onExit?.(code)
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
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    })
  }

  function notify(method: string, params: unknown): void {
    if (closed) return
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
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
    close: function (): void {
      closed = true
      try {
        child.stdin.end()
      } catch {
        // 已经关掉了
      }
      child.kill()
    }
  }
}

export { spawnGooseAcp }
export type {
  AgentCapabilities,
  GooseAcpClient,
  GooseAcpOptions,
  InitializeResult,
  NewSessionResult,
  PermissionChoice,
  PermissionDecision,
  PermissionPrompt,
  PermissionRequestHandler
}
