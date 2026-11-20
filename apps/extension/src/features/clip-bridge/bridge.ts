import { MESSAGE_EXTERNAL_CLIP, MESSAGE_HEALTH, parseDelivery, parseHealthMessage } from '@cogito/clipper/protocol'

import type { ClientHealth, ClipDelivery } from '@cogito/clipper/protocol'

const STORAGE_CLIPPER_ID = 'cogito.clipper.id'

async function findClipperId(): Promise<string> {
  try {
    const bag = await chrome.storage.local.get(STORAGE_CLIPPER_ID)
    const value = bag[STORAGE_CLIPPER_ID]
    return typeof value === 'string' ? value.trim() : ''
  } catch (error) {
    console.error('[clip] 读取剪藏扩展 ID 失败', error)
    return ''
  }
}

async function writeClipperId(id: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_CLIPPER_ID]: id.trim() })
  } catch (error) {
    console.error('[clip] 保存剪藏扩展 ID 失败', error)
    throw error
  }
}

async function requestClip(clipperId: string): Promise<ClipDelivery> {
  const response: unknown = await chrome.runtime.sendMessage(clipperId, {
    type: MESSAGE_EXTERNAL_CLIP
  })
  return parseDelivery(response)
}

async function requestHealth(clipperId: string): Promise<ClientHealth | null> {
  const response: unknown = await chrome.runtime.sendMessage(clipperId, {
    type: MESSAGE_HEALTH
  })
  return parseHealthMessage(response)
}

export { STORAGE_CLIPPER_ID, findClipperId, requestClip, requestHealth, writeClipperId }
