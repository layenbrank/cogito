import { parseClipResult } from '@cogito/clipper/protocol'

import type { ClipDelivery } from '@cogito/clipper/protocol'

const STORAGE_CLIP_DELIVERY = 'cogito.clip.delivery'

function acceptClipResult(message: unknown): boolean {
  const parsed = parseClipResult(message)
  if (!parsed) return false
  void chrome.storage.local.set({ [STORAGE_CLIP_DELIVERY]: parsed.delivery }).catch(function (error: unknown) {
    console.error('[clip] 记录剪藏结果失败', error)
  })
  return true
}

function parseStoredDelivery(value: unknown): ClipDelivery | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.ok !== 'boolean') return null
  return {
    ok: record.ok,
    status: typeof record.status === 'number' ? record.status : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    body: typeof record.body === 'string' ? record.body : undefined,
    title: typeof record.title === 'string' ? record.title : undefined,
    url: typeof record.url === 'string' ? record.url : undefined,
    port: typeof record.port === 'number' ? record.port : undefined
  }
}

export { STORAGE_CLIP_DELIVERY, acceptClipResult, parseStoredDelivery }
