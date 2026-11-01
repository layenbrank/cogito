import { invoke } from '@tauri-apps/api/core'

import { findFaviconFallback } from '@/features/magnetic-tile/mark.ts'
import { CHANNELS } from '@/shared/ipc/channels'

interface FetchFaviconResult {
  favicon: string
}

/**
 * 经 Tauri 解析站点 favicon；失败时回退 DuckDuckGo，并打日志。
 * 二者皆不可用时返回 null。
 */
async function fetchSiteFavicon(url: string): Promise<string | null> {
  const trimmed = url.trim()
  if (!trimmed) return null

  try {
    const result = await invoke<FetchFaviconResult>(CHANNELS.SITE.FETCH_FAVICON, {
      body: { url: trimmed }
    })
    if (result?.favicon) return result.favicon
  } catch (error) {
    console.warn('[site] fetch-favicon 失败，回退 DDG:', error)
  }

  return findFaviconFallback(trimmed)
}

export type { FetchFaviconResult }
export { fetchSiteFavicon }
