import { MESSAGE_CLIP_RESULT } from './constants.ts'

interface ClipPayload {
  title: string
  url: string
  markdown: string
}

interface ClipDelivery {
  ok: boolean
  status?: number
  error?: string
  body?: string
  title?: string
  url?: string
  port?: number
}

interface ClientHealth {
  ok: true
  port: number
  clipCount?: number
  lastClipAt?: number
}

interface ClipResultEnvelope {
  type: typeof MESSAGE_CLIP_RESULT
  delivery: ClipDelivery
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

function parseHealthMessage(value: unknown): ClientHealth | null {
  if (!isRecord(value) || value.ok !== true) return null
  if (typeof value.port !== 'number') return null
  return parseHealth(value.port, value)
}

function parseClipResult(value: unknown): ClipResultEnvelope | null {
  if (!isRecord(value) || value.type !== MESSAGE_CLIP_RESULT) return null
  return { type: MESSAGE_CLIP_RESULT, delivery: parseDelivery(value.delivery) }
}

function formatDelivery(delivery: ClipDelivery): string {
  if (delivery.ok) return `已发送 (${delivery.status ?? 200})`
  return `失败：${delivery.error || delivery.body || 'unknown'}`
}

function readMessageType(value: unknown): string | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  return value.type
}

export { formatDelivery, isRecord, parseClipResult, parseDelivery, parseHealth, parseHealthMessage, parsePayload, readMessageType }
export type { ClientHealth, ClipDelivery, ClipPayload, ClipResultEnvelope }
