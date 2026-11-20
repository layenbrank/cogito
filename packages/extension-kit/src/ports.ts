import { CLIP_PORT_ISOLATED, CLIP_PORT_RELEASE } from './constants.ts'
import { orderPorts } from './client.ts'

/**
 * 上次应答过的 client 端口。
 *
 * 存在 `chrome.storage.local`：正式包与隔离 dev 都装着时，各占 19828 / 19829，
 * 记住哪个真的答过，剪藏就写到哪个实例的库里。
 */
const STORAGE_CLIENT_PORT = 'cogito.clip.client-port'

async function findPreferredPort(): Promise<number | null> {
  try {
    const bag = await chrome.storage.local.get(STORAGE_CLIENT_PORT)
    const value = bag[STORAGE_CLIENT_PORT]
    if (value === CLIP_PORT_RELEASE || value === CLIP_PORT_ISOLATED) return value
    return null
  } catch (error) {
    console.error('[clip] 读取端口失败', error)
    return null
  }
}

async function rememberPort(port: number): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_CLIENT_PORT]: port })
  } catch (error) {
    console.error('[clip] 记录端口失败', error)
  }
}

async function findPortOrder(): Promise<number[]> {
  const preferred = await findPreferredPort()
  return orderPorts(preferred)
}

export { findPortOrder, rememberPort }
