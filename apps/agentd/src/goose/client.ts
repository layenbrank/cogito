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

import { createLineSplitter, parseMessage } from './protocol'
import type { JsonRpcRequest } from './protocol'

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
  close(): void
}

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

  const pending = new Map<number, PendingRequest>()
  const updateListeners = new Set<(sessionId: string, update: unknown) => void>()
  const splitter = createLineSplitter()
  let nextId = 1
  let closed = false

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', function (chunk: string) {
    for (const line of splitter.push(chunk)) {
      const message = parseMessage(line)
      if (!message) continue
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
export type { AgentCapabilities, GooseAcpClient, GooseAcpOptions, InitializeResult, NewSessionResult }
