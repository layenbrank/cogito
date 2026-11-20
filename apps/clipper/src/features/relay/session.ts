import { CLIP_PORT_ISOLATED, CLIP_PORT_RELEASE, MESSAGE_CLIP_RESULT } from '@/protocol/constants.ts'
import { orderPorts } from '@/protocol/client.ts'

import type { ClipDelivery } from '@/protocol/payload.ts'

const STORAGE_CLIENT_PORT = 'cogito.clip.client-port'
const STORAGE_EXTENSION_ID = 'cogito.extension.id'

async function findPreferredPort(): Promise<number | null> {
  try {
    const bag = await chrome.storage.local.get(STORAGE_CLIENT_PORT)
    const value = bag[STORAGE_CLIENT_PORT]
    if (value === CLIP_PORT_RELEASE || value === CLIP_PORT_ISOLATED) return value
    return null
  } catch (error) {
    console.error('[clipper] 读取端口失败', error)
    return null
  }
}

async function rememberPort(port: number): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_CLIENT_PORT]: port })
  } catch (error) {
    console.error('[clipper] 记录端口失败', error)
  }
}

async function findPortOrder(): Promise<number[]> {
  const preferred = await findPreferredPort()
  return orderPorts(preferred)
}

async function findExtensionId(): Promise<string> {
  try {
    const bag = await chrome.storage.local.get(STORAGE_EXTENSION_ID)
    const value = bag[STORAGE_EXTENSION_ID]
    return typeof value === 'string' ? value.trim() : ''
  } catch (error) {
    console.error('[clipper] 读取扩展 ID 失败', error)
    return ''
  }
}

async function writeExtensionId(id: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_EXTENSION_ID]: id.trim() })
  } catch (error) {
    console.error('[clipper] 保存扩展 ID 失败', error)
    throw error
  }
}

async function notifyExtension(delivery: ClipDelivery): Promise<void> {
  const id = await findExtensionId()
  if (!id) return
  try {
    await chrome.runtime.sendMessage(id, { type: MESSAGE_CLIP_RESULT, delivery })
  } catch (error) {
    console.error('[clipper] 通知扩展失败', error)
  }
}

export { STORAGE_EXTENSION_ID, findExtensionId, findPortOrder, notifyExtension, rememberPort, writeExtensionId }
