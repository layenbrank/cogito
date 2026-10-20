/**
 * 搜索建议 IPC（Tauri `search:suggest` → Bing AS）
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function parseSuggestion(payload: unknown): Engine.Suggestion {
  if (!payload || typeof payload !== 'object') {
    throw new Error('search:suggest 无效')
  }

  const record = payload as Record<string, unknown>

  if (Array.isArray(record.s)) {
    return {
      s: record.s as Engine.Item[],
      i: (record.i as Engine.Info) ?? { ig: '' }
    }
  }

  throw new Error('search:suggest 缺少 s')
}

async function suggestion(qry: string): Promise<Engine.Suggestion> {
  const payload = await invoke<unknown>(CHANNELS.SEARCH.SUGGEST, {
    body: { qry }
  })
  return parseSuggestion(payload)
}

const EngineIpc = {
  suggestion
}

export { EngineIpc }
