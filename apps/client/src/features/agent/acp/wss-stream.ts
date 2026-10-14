/**
 * 指纹 pinning 的 WebSocket 适配：经 Rust goose:acp-* 建立 WSS。
 * send 对外同步，对内串行 await invoke，保证 JSON-RPC 顺序。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { WebSocketConstructor } from '@agentclientprotocol/sdk/experimental/ws-client'

import { CHANNELS, EVENTS } from '@/shared/ipc/channels'

const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1
const SOCKET_CLOSING = 2
const SOCKET_CLOSED = 3

type SocketListener = (event: unknown) => void

interface AcpMessagePayload {
  id: string
  data: string
}

interface AcpIdPayload {
  id: string
}

interface AcpErrorPayload {
  id: string
  message: string
}

class GoosePinnedWebSocket {
  readyState = SOCKET_CONNECTING
  private connectionId: string | null = null
  private listeners = new Map<string, Set<SocketListener>>()
  private unlisteners: UnlistenFn[] = []
  private closed = false
  private sendQueue: Promise<void> = Promise.resolve()
  private url: string
  private fingerprint: string

  constructor(url: string, fingerprint: string) {
    this.url = url
    this.fingerprint = fingerprint
    void this.open()
  }

  addEventListener(type: string, listener: SocketListener) {
    const bucket = this.listeners.get(type) ?? new Set()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  removeEventListener(type: string, listener: SocketListener) {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string) {
    if (!this.connectionId || this.readyState !== SOCKET_OPEN) {
      throw new Error('ACP WSS 尚未打开')
    }
    const id = this.connectionId
    this.sendQueue = this.sendQueue
      .then(() => invoke<void>(CHANNELS.GOOSE.ACP_SEND, { id, data }))
      .catch((error: unknown) => {
        this.emit('error', error)
      })
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.readyState = SOCKET_CLOSING
    const id = this.connectionId
    this.connectionId = null
    for (const unlisten of this.unlisteners.splice(0)) {
      unlisten()
    }
    if (id) {
      // 关不掉也要留痕（丢给 error 监听）：静默吞掉会让 ACP 侧以为自己还握着这条连接
      void invoke(CHANNELS.GOOSE.ACP_CLOSE, { id }).catch((error: unknown) => {
        this.emit('error', error)
      })
    }
    this.readyState = SOCKET_CLOSED
    this.emit('close', {})
  }

  private async open() {
    try {
      const settled = await Promise.allSettled([
        listen<AcpMessagePayload>(EVENTS.GOOSE_ACP_MESSAGE, (event) => {
          if (!this.connectionId || event.payload.id !== this.connectionId) return
          this.emit('message', { data: event.payload.data })
        }),
        listen<AcpIdPayload>(EVENTS.GOOSE_ACP_CLOSE, (event) => {
          if (!this.connectionId || event.payload.id !== this.connectionId) return
          this.close()
        }),
        listen<AcpErrorPayload>(EVENTS.GOOSE_ACP_ERROR, (event) => {
          if (!this.connectionId || event.payload.id !== this.connectionId) return
          this.emit('error', new Error(event.payload.message))
        })
      ])

      // 少挂一个监听就等于收不到消息：已登记的照收，失败的原因汇总后抛出（不会被吞）
      const failures: unknown[] = []
      for (const result of settled) {
        if (result.status === 'fulfilled') this.unlisteners.push(result.value)
        else failures.push(result.reason)
      }
      if (failures.length > 0) {
        for (const unlisten of this.unlisteners.splice(0)) {
          unlisten()
        }
        throw new AggregateError(failures, 'ACP WSS 事件监听注册失败')
      }

      const id = await invoke<string>(CHANNELS.GOOSE.ACP_OPEN, {
        url: this.url,
        fingerprint: this.fingerprint
      })
      if (this.closed) {
        // 早退路径的关闭失败交给外层 catch 统一上报，不静默吞掉
        await invoke(CHANNELS.GOOSE.ACP_CLOSE, { id })
        return
      }
      this.connectionId = id
      this.readyState = SOCKET_OPEN
      this.emit('open', {})
    } catch (error) {
      this.readyState = SOCKET_CLOSED
      this.emit('error', error)
      this.emit('close', {})
    }
  }

  private emit(type: string, event: unknown) {
    this.listeners.get(type)?.forEach((listener) => {
      listener(event)
    })
  }
}

function createPinnedWebSocketCtor(fingerprint: string): WebSocketConstructor {
  return class PinnedWebSocket extends GoosePinnedWebSocket {
    constructor(url: string) {
      super(url, fingerprint)
    }
  }
}

export { createPinnedWebSocketCtor }
