/**
 * Web 搜索建议 provider（search:suggest + 引擎 match）
 */
import { openUrl } from '@tauri-apps/plugin-opener'

import { findEngine } from '@/constants/engine'
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { readEngineKey } from '@/features/command-bar/store'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import {
  buildMatchUrl,
  findItemUrl,
  isUrlKeyword,
  parseKeywordUrl,
  parseSuggestionLabel
} from '@/features/command-bar/url'
import { EngineIpc } from '@/lib/engine-ipc'

/** 同步即时命中：打开网址 / 在引擎搜索（不依赖 IPC，跟手刷新） */
function findInstantWebHits(query: string): Hit[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const engine = findEngine(readEngineKey())
  const hits: Hit[] = []

  if (isUrlKeyword(trimmed)) {
    hits.push({
      domain: 'web',
      id: `url:${trimmed}`,
      title: parseKeywordUrl(trimmed),
      subtitle: '打开网址',
      score: 1,
      icon: 'lucide:link',
      async run() {
        await openUrl(parseKeywordUrl(trimmed))
      }
    })
  }

  hits.push({
    domain: 'web',
    id: `match:${engine.key}:${trimmed}`,
    title: `在 ${engine.label} 搜索「${trimmed}」`,
    subtitle: engine.origin,
    score: 0.95,
    icon: engine.icon,
    async run() {
      await openUrl(buildMatchUrl(engine.match, trimmed))
    }
  })

  return hits
}

async function findWebSuggestions(
  query: string,
  signal: AbortSignal
): Promise<Hit[]> {
  const trimmed = query.trim()
  if (!trimmed || signal.aborted) return []

  const engine = findEngine(readEngineKey())

  try {
    const suggestion = await EngineIpc.suggestion(trimmed)
    if (signal.aborted) return []
    const series = (suggestion.s ?? []).slice(0, OMNIBAR_UI.WEB_LIMIT)
    const hits: Hit[] = []
    for (const [index, item] of series.entries()) {
      const label = parseSuggestionLabel(item.q)
      if (!label) continue
      hits.push({
        domain: 'web',
        id: `suggest:${item.id || label}:${index}`,
        title: label,
        subtitle: `${engine.label} 建议`,
        score: 0.9 - index * 0.02,
        icon: engine.icon,
        async run() {
          await openUrl(findItemUrl(engine, item))
        }
      })
    }
    return hits
  } catch (error) {
    if (!signal.aborted) {
      console.warn('[command-bar] web suggestion failed:', error)
    }
    return []
  }
}

async function searchWeb(query: string, signal: AbortSignal): Promise<Hit[]> {
  const instant = findInstantWebHits(query)
  if (!query.trim() || signal.aborted) return instant
  const suggestions = await findWebSuggestions(query, signal)
  if (signal.aborted) return instant
  return [...instant, ...suggestions]
}

const webProvider: SearchProvider = {
  domain: 'web',
  search(query, signal) {
    return searchWeb(query, signal)
  }
}

export { webProvider, findInstantWebHits, findWebSuggestions }
