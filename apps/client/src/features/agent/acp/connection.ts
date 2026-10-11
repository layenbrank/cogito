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
  type InitializeResponse,
  type RequestPermissionRequest
} from '@agentclientprotocol/sdk'
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client'

import { ensureAutoCompactThreshold } from '@/features/agent/acp/goose-providers'
import { requestAcpPermission } from '@/features/agent/acp/permission'
import { createPinnedWebSocketCtor } from '@/features/agent/acp/wss-stream'
import { CHANNELS, EVENTS } from '@/shared/ipc/channels'

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

const ACP_INITIALIZE_TIMEOUT_MS = 10_000
const CLIENT_NAME = 'i-thinking'
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
    } catch {
      // ignore
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
    WebSocket: createPinnedWebSocketCtor(info.certFingerprint)
  })

  const app = client({ name: CLIENT_NAME }).onRequest(
    methods.client.session.requestPermission,
    async function (context) {
      return requestAcpPermission(context.params as RequestPermissionRequest)
    }
  )

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

export { bindGooseNotReady, clearAcpHandle, findAcpHandle }
export type { AcpHandle, GooseServeConnection }
