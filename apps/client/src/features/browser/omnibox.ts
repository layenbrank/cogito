/**
 * 浏览器地址栏 omnibox：URL / 搜索分流 + Bing AS 建议。
 *
 * 对齐 Chrome：像网址就导航；否则走当前引擎搜索。建议复用主窗 `search:suggest`。
 */
import { findEngine } from '@/constants/engine'
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { readEngineKey } from '@/features/command-bar/store'
import {
  buildMatchUrl,
  findItemUrl,
  isUrlKeyword,
  parseKeywordUrl,
  parseSuggestionLabel
} from '@/features/command-bar/url'
import { parseAddress } from '@/features/browser/address'
import { EngineIpc } from '@/lib/engine-ipc'

type OmniboxKind = 'url' | 'search'

interface OmniboxTarget {
  kind: OmniboxKind
  /** 最终交给 webview 的 URL */
  url: string
  label: string
}

interface OmniboxSuggestion {
  id: string
  title: string
  subtitle: string
  icon: string
  target: OmniboxTarget
}

/** 输入 → 打开网址或引擎搜索（Chrome omnibox 分流） */
function resolveOmnibox(input: string): OmniboxTarget | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // host.tld / localhost / IP / http(s):// …
  if (isUrlKeyword(trimmed)) {
    const url = parseAddress(trimmed) || parseKeywordUrl(trimmed)
    return { kind: 'url', url, label: url }
  }

  // about: / data: / file: 等不走搜索
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const url = parseAddress(trimmed)
    if (url) return { kind: 'url', url, label: url }
  }

  const engine = findEngine(readEngineKey())
  return {
    kind: 'search',
    url: buildMatchUrl(engine.match, trimmed),
    label: `在 ${engine.label} 搜索「${trimmed}」`
  }
}

/** 同步即时行：打开网址 + 搜索 */
function findInstantOmniboxSuggestions(input: string): OmniboxSuggestion[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  const engine = findEngine(readEngineKey())
  const rows: OmniboxSuggestion[] = []

  if (isUrlKeyword(trimmed)) {
    const url = parseAddress(trimmed) || parseKeywordUrl(trimmed)
    rows.push({
      id: `url:${url}`,
      title: url,
      subtitle: '打开网址',
      icon: 'lucide:link',
      target: { kind: 'url', url, label: url }
    })
  }

  rows.push({
    id: `search:${engine.key}:${trimmed}`,
    title: `在 ${engine.label} 搜索「${trimmed}」`,
    subtitle: engine.origin,
    icon: engine.icon,
    target: {
      kind: 'search',
      url: buildMatchUrl(engine.match, trimmed),
      label: trimmed
    }
  })

  return rows
}

async function findRemoteOmniboxSuggestions(
  input: string,
  signal: AbortSignal
): Promise<OmniboxSuggestion[]> {
  const trimmed = input.trim()
  if (!trimmed || signal.aborted) return []

  const engine = findEngine(readEngineKey())
  try {
    const suggestion = await EngineIpc.suggestion(trimmed)
    if (signal.aborted) return []
    const series = (suggestion.s ?? []).slice(0, OMNIBAR_UI.WEB_LIMIT)
    const rows: OmniboxSuggestion[] = []
    for (const [index, item] of series.entries()) {
      const label = parseSuggestionLabel(item.q)
      if (!label) continue
      const url = findItemUrl(engine, item)
      rows.push({
        id: `suggest:${item.id || label}:${index}`,
        title: label,
        subtitle: `${engine.label} 建议`,
        icon: engine.icon,
        target: { kind: 'search', url, label }
      })
    }
    return rows
  } catch (error) {
    if (!signal.aborted) {
      console.warn('[browser/omnibox] 拉取建议失败:', error)
    }
    return []
  }
}

export type { OmniboxKind, OmniboxSuggestion, OmniboxTarget }
export { findInstantOmniboxSuggestions, findRemoteOmniboxSuggestions, resolveOmnibox }
