/** 投递给 client 的正文（`POST /clip` 的 body） */
interface ClipPayload {
  title: string
  url: string
  markdown: string
}

/** 一次投递的结果：成功带端口与 HTTP 状态，失败带原因 */
interface ClipDelivery {
  ok: boolean
  status?: number
  error?: string
  body?: string
  title?: string
  url?: string
  port?: number
}

/** `GET /health` 的回执（只取界面用得到的两个计数） */
interface ClientHealth {
  ok: true
  port: number
  clipCount?: number
  lastClipAt?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePayload(value: unknown): ClipPayload | null {
  if (!isRecord(value)) return null
  if (typeof value.title !== 'string') return null
  if (typeof value.url !== 'string') return null
  if (typeof value.markdown !== 'string') return null
  return { title: value.title, url: value.url, markdown: value.markdown }
}

function parseDelivery(value: unknown): ClipDelivery {
  if (!isRecord(value)) return { ok: false, error: 'unknown' }
  return {
    ok: value.ok === true,
    status: typeof value.status === 'number' ? value.status : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    body: typeof value.body === 'string' ? value.body : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    url: typeof value.url === 'string' ? value.url : undefined,
    port: typeof value.port === 'number' ? value.port : undefined
  }
}

function parseHealth(port: number, body: unknown): ClientHealth {
  const record = isRecord(body) ? body : {}
  return {
    ok: true,
    port,
    clipCount: typeof record.clipCount === 'number' ? record.clipCount : undefined,
    lastClipAt: typeof record.lastClipAt === 'number' ? record.lastClipAt : undefined
  }
}

function formatDelivery(delivery: ClipDelivery): string {
  if (delivery.ok) return `已发送 (${delivery.status ?? 200})`
  return `失败：${delivery.error || delivery.body || 'unknown'}`
}

/** 消息分派前的类型守卫：只认带字符串 `type` 的对象 */
function readMessageType(value: unknown): string | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  return value.type
}

export { formatDelivery, isRecord, parseDelivery, parseHealth, parsePayload, readMessageType }
export type { ClientHealth, ClipDelivery, ClipPayload }
