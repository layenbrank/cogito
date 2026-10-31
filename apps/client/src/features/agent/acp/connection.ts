/**
 * ACP 连接单例：goose:connection → pinned WSS → initialize
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  client,
  methods,
  PROTOCOL_VERSION,
  type ClientConnection,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification
} from '@agentclientprotocol/sdk'
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client'

import { ensureAutoCompactThreshold } from '@/features/agent/acp/goose-providers'
import { makePinnedWebSocketCtor } from '@/features/agent/acp/wss-stream'
import { CHANNELS, EVENTS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'

interface GooseServeConnection {
  url: string
  token: string
  port: number
  certFingerprint: string
}

interface AcpHandle {
  connection: ClientConnection
  initializeResponse: InitializeResponse
  needsProviderAuth: boolean
  /**
   * goose 是否声明支持 session/load（刷新后恢复进行中回合的正确路径）。
   *
   * goose 声明 `loadSession` 但**不**声明 `sessionCapabilities.resume`：load 会重放全量历史
   * 并把会话 attach 回当前连接，后台仍在跑的一轮其后续 update 会继续推来。
   */
  canLoadSession: boolean
}

/**
 * agent 反向发起的请求（审批 / 追问）由会话控制器接管。
 *
 * 用注入而不是 import：`session.ts` 需要 `connection.ts` 的 handle，两边直接互相 import
 * 会形成模块环（而 `session.ts` 在模块顶部就要登记「goose 未就绪」回调，环里跑初始化容易踩到
 * 半初始化的模块）。
 */
interface AcpRequestRouter {
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>
  requestElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse>
}

let router: AcpRequestRouter | null = null

/** 由 `session.ts` 在模块初始化时调用 */
function bindAcpRequestRouter(next: AcpRequestRouter) {
  router = next
}

/** 全局 session/update 通知：刷新后恢复进行中回合时按 sessionId 路由（由 `session.ts` 注入） */
type SessionUpdateRoute = (notification: SessionNotification) => void
let sessionUpdateRoute: SessionUpdateRoute | null = null

function bindSessionUpdateRoute(next: SessionUpdateRoute | null) {
  sessionUpdateRoute = next
}

const ACP_INITIALIZE_TIMEOUT_MS = 10_000
const CLIENT_NAME = 'cogito'
const CLIENT_VERSION = '1.4.0'
const GOOSE_PROVIDER_AUTH_ID = 'goose-provider'

let current: AcpHandle | null = null
let pending: Promise<AcpHandle> | null = null
let notReadyBound = false
let onNotReady: (() => void) | null = null

async function findGooseConnection(): Promise<GooseServeConnection> {
  return invoke<GooseServeConnection>(CHANNELS.GOOSE.CONNECTION)
}

function clearAcpHandle() {
  const handle = current
  current = null
  pending = null
  if (handle) {
    try {
      handle.connection.close()
    } catch (error) {
      // 连接可能已经断了；仍要留痕，不让失败无声无息
      console.warn('[acp] 关闭连接失败（多半已断开）:', error)
    }
  }
}

/** 单测 / 浏览器预览没有 Tauri 事件桥：判定后再绑，避免 import 阶段就抛 */
function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

/** 由 goose-acp 注册：serve 退出时清 session + handle */
function bindGooseNotReady(handler: () => void) {
  onNotReady = handler
  if (notReadyBound) return
  if (!hasTauriRuntime()) return
  notReadyBound = true
  void listen(EVENTS.GOOSE_NOT_READY, function () {
    clearAcpHandle()
    onNotReady?.()
  }).catch(function (error) {
    reportCaught('acp.connection.not-ready', error, 'warning')
  })
}

async function openAcpHandle(): Promise<AcpHandle> {
  const info = await findGooseConnection()
  const stream = createWebSocketStream(info.url, {
    protocols: [],
    WebSocket: makePinnedWebSocketCtor(info.certFingerprint)
  })

  const app = client({ name: CLIENT_NAME })
    .onRequest(methods.client.session.requestPermission, async function (context) {
      const params = context.params
      // 没有被接管的请求（例如还没开跑）一律按取消回：宁可让 agent 知道没被批准，也不能挂着
      return router ? router.requestPermission(params) : { outcome: { outcome: 'cancelled' as const } }
    })
    .onRequest(methods.client.elicitation.create, async function (context) {
      const params = context.params
      return router ? router.requestElicitation(params) : { action: 'cancel' as const }
    })
    .onNotification(methods.client.session.update, function (context) {
      // SessionUpdateRouter 是观察者（不消费），这里才是真正的消费者：交给 session.ts
      // 按 sessionId 路由到「恢复中的会话」队列，恢复刷新后丢掉的更新订阅。
      sessionUpdateRoute?.(context.params)
    })

  const connection = app.connect(stream)

  try {
    const initializeResponse = await withTimeout(
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false }
        },
        clientInfo: {
          name: CLIENT_NAME,
          version: CLIENT_VERSION
        }
      }),
      ACP_INITIALIZE_TIMEOUT_MS,
      `ACP initialize timed out after ${ACP_INITIALIZE_TIMEOUT_MS}ms`
    )

    const needsProviderAuth = (initializeResponse.authMethods ?? []).some(function (item) {
      return item.id === GOOSE_PROVIDER_AUTH_ID
    })
    const canLoadSession = Boolean(initializeResponse.agentCapabilities?.loadSession)

    const handle: AcpHandle = {
      connection,
      initializeResponse,
      needsProviderAuth,
      canLoadSession
    }
    current = handle
    void ensureAutoCompactThreshold(connection)
    connection.closed.then(
      function () {
        if (current === handle) {
          current = null
          pending = null
        }
      },
      function () {
        if (current === handle) {
          current = null
          pending = null
        }
      }
    )
    return handle
  } catch (error) {
    connection.close(error)
    reportCaught('agent.acp.connect', error, 'error', { phase: 'initialize' })
    throw error
  }
}

async function findAcpHandle(): Promise<AcpHandle> {
  if (current) return current
  if (!pending) {
    pending = openAcpHandle().catch(function (error) {
      pending = null
      throw error
    })
  }
  return pending
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<T>(function (_, reject) {
    timer = setTimeout(function () {
      reject(new Error(message))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export {
  bindAcpRequestRouter,
  bindGooseNotReady,
  bindSessionUpdateRoute,
  clearAcpHandle,
  findAcpHandle
}
export type { AcpHandle, GooseServeConnection }
