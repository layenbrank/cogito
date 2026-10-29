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
  type RequestPermissionResponse
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

/** 由 goose-acp 注册：serve 退出时清 session + handle */
function bindGooseNotReady(handler: () => void) {
  onNotReady = handler
  if (notReadyBound) return
  notReadyBound = true
  void listen(EVENTS.GOOSE_NOT_READY, function () {
    clearAcpHandle()
    onNotReady?.()
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

    const handle: AcpHandle = { connection, initializeResponse, needsProviderAuth }
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

export { bindAcpRequestRouter, bindGooseNotReady, clearAcpHandle, findAcpHandle }
export type { AcpHandle, GooseServeConnection }
