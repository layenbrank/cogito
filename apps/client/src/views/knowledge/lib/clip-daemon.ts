/**
 * Clip 守护状态：轮询 127.0.0.1:19828/health。
 */
import { invoke } from '@tauri-apps/api/core'

const CLIP_HEALTH_URL = 'http://127.0.0.1:19828/health'
const API_HEALTH_URL = 'http://127.0.0.1:19828/api/v1/health'

interface ClipDaemonStatus {
  running: boolean
  port: number
  clipCount: number
  lastClipAt: number
  apiOk: boolean
  detail?: string
}

async function fetchClipDaemonStatus(): Promise<ClipDaemonStatus> {
  try {
    const rust = await invoke<{
      running?: boolean
      port?: number
    }>('wiki_http_status')
    if (rust && typeof rust === 'object' && rust.running === false) {
      return {
        running: false,
        port: rust.port ?? 19828,
        clipCount: 0,
        lastClipAt: 0,
        apiOk: false,
        detail: '本机 HTTP 未绑定'
      }
    }
  } catch (error) {
    console.warn('[clip-daemon] wiki_http_status failed', error)
  }

  try {
    const response = await fetch(CLIP_HEALTH_URL, { method: 'GET' })
    if (!response.ok) {
      return {
        running: false,
        port: 19828,
        clipCount: 0,
        lastClipAt: 0,
        apiOk: false,
        detail: `health HTTP ${response.status}`
      }
    }
    const json = (await response.json()) as {
      clipCount?: number
      lastClipAt?: number
      port?: number
    }
    let apiOk = false
    try {
      const api = await fetch(API_HEALTH_URL)
      apiOk = api.ok
    } catch (apiError) {
      console.warn('[clip-daemon] api health failed', apiError)
    }
    return {
      running: true,
      port: json.port ?? 19828,
      clipCount: Number(json.clipCount) || 0,
      lastClipAt: Number(json.lastClipAt) || 0,
      apiOk
    }
  } catch (error) {
    console.warn('[clip-daemon] health failed', error)
    return {
      running: false,
      port: 19828,
      clipCount: 0,
      lastClipAt: 0,
      apiOk: false,
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

export { API_HEALTH_URL, CLIP_HEALTH_URL, fetchClipDaemonStatus }
export type { ClipDaemonStatus }
