/**
 * ACP 的 stdio 线格式：**NDJSON**（一行一个 JSON-RPC 2.0 消息）。
 *
 * 之所以自己写 40 行而不是引 `@agentclientprotocol/sdk`：
 * S3 spike 已经用裸分帧跑通了 initialize / session-new / _goose/* 全链路，
 * 而 SDK 1.7 的 Node transport 面还不稳定（上游 2.7 才补 `./experimental/node`）。
 * 等 `_goose/*` 的类型需要复用再引 SDK，届时只换这一层。
 */

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: JsonRpcError
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

interface LineSplitter {
  /** 喂一段 utf8 文本，返回**完整的**行（不含空行） */
  push(chunk: string): string[]
  /** 残留未成行的尾巴（诊断用） */
  pending(): string
}

/**
 * 行分帧器。三条硬要求（Windows 上尤其容易踩）：
 * 1. 只按 `\n` 切，`\r` 靠 trim 掉，不做 CRLF 归一（ACP 一端就是 `\n`）；
 * 2. 半行必须留在缓冲里等下一段（stdio 的 chunk 与行边界无关）；
 * 3. 空行丢弃，不能让 JSON.parse 炸掉整条流。
 */
function createLineSplitter(): LineSplitter {
  let buffer = ''
  return {
    push: function (chunk: string): string[] {
      buffer += chunk
      const lines: string[] = []
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line.length > 0) lines.push(line)
        index = buffer.indexOf('\n')
      }
      return lines
    },
    pending: function (): string {
      return buffer
    }
  }
}

function parseMessage(line: string): JsonRpcResponse | JsonRpcNotification | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>
    if (typeof value !== 'object' || value === null) return null
    if (typeof value.method === 'string') return value as unknown as JsonRpcNotification
    if (typeof value.id === 'number') return value as unknown as JsonRpcResponse
    return null
  } catch {
    return null
  }
}

export { createLineSplitter, parseMessage }
export type { JsonRpcError, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, LineSplitter }
