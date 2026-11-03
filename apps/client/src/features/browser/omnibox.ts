/**
 * 浏览器地址栏 omnibox：URL / 搜索分流 + 本地历史 + Bing AS。
 *
 * 建议优先级：即时打开/搜索 → 本地（访问记录 / 会话历史 / 导航磁贴）→ 远程 AS。
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
import type { BrowserNavigationEntry } from '@/features/browser/api'
import { matchBrowserVisits } from '@/features/browser/visit-history'
import { EngineIpc } from '@/lib/engine-ipc'
import { useMirrorStore } from '@/stores/mirror'

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

const LOCAL_LIMIT = 6

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

function toHistorySuggestion(
  id: string,
  url: string,
  title: string,
  subtitle: string,
  icon: string
): OmniboxSuggestion {
  return {
    id,
    title: title || url,
    subtitle,
    icon,
    target: { kind: 'url', url, label: title || url }
  }
}

function matchesQuery(query: string, title: string, url: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return title.toLowerCase().includes(needle) || url.toLowerCase().includes(needle)
}

/** 导航磁贴（mirror 同步态） */
function findNavigationTileSuggestions(query: string): OmniboxSuggestion[] {
  const tiles = useMirrorStore.getState().magneticTiles.filter(function (tile) {
    return tile.component === 'navigation' && Boolean(tile.url)
  })
  const rows: OmniboxSuggestion[] = []
  for (const tile of tiles) {
    const url = tile.url.trim()
    if (!url) continue
    if (!matchesQuery(query, tile.title, url)) continue
    rows.push(
      toHistorySuggestion(`tile:${tile.id}`, url, tile.title || url, '导航磁贴', 'lucide:globe')
    )
    if (rows.length >= LOCAL_LIMIT) break
  }
  return rows
}

/** 跨会话访问记录 + 导航磁贴（同步） */
function findLocalOmniboxSuggestions(input: string): OmniboxSuggestion[] {
  const query = input.trim()
  const rows: OmniboxSuggestion[] = []
  const seen = new Set<string>()

  function push(row: OmniboxSuggestion) {
    const key = row.target.url
    if (seen.has(key)) return
    seen.add(key)
    rows.push(row)
  }

  for (const visit of matchBrowserVisits(query, LOCAL_LIMIT)) {
    push(
      toHistorySuggestion(
        `visit:${visit.url}`,
        visit.url,
        visit.title,
        '历史记录',
        'lucide:history'
      )
    )
  }

  for (const row of findNavigationTileSuggestions(query)) {
    push(row)
    if (rows.length >= LOCAL_LIMIT) break
  }

  return rows.slice(0, LOCAL_LIMIT)
}

/** 当前 tab 会话历史（CDP）；失败静默 */
async function findSessionOmniboxSuggestions(
  input: string,
  entries: readonly BrowserNavigationEntry[] | null | undefined
): Promise<OmniboxSuggestion[]> {
  if (!entries || entries.length === 0) return []
  const query = input.trim()
  const rows: OmniboxSuggestion[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry.url || entry.url === 'about:blank') continue
    if (!matchesQuery(query, entry.title, entry.url)) continue
    if (seen.has(entry.url)) continue
    seen.add(entry.url)
    rows.push(
      toHistorySuggestion(
        `session:${entry.url}`,
        entry.url,
        entry.title || entry.url,
        '本页历史',
        'lucide:book-open'
      )
    )
    if (rows.length >= LOCAL_LIMIT) break
  }
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

function normalizeOmniboxUrlKey(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

/** 合并建议：即时 → 本地历史 → 会话 → 远程；按 URL/标题去重 */
function mergeOmniboxSuggestions(
  instant: OmniboxSuggestion[],
  local: OmniboxSuggestion[],
  session: OmniboxSuggestion[],
  remote: OmniboxSuggestion[]
): OmniboxSuggestion[] {
  const out: OmniboxSuggestion[] = []
  const seenUrl = new Set<string>()
  const seenTitle = new Set<string>()

  function push(row: OmniboxSuggestion) {
    const urlKey = normalizeOmniboxUrlKey(row.target.url)
    const titleKey = row.title.trim().toLowerCase()
    if (urlKey && seenUrl.has(urlKey)) return
    if (titleKey && seenTitle.has(titleKey) && row.target.kind === 'search') return
    if (urlKey) seenUrl.add(urlKey)
    if (titleKey) seenTitle.add(titleKey)
    out.push(row)
  }

  for (const row of instant) push(row)
  for (const row of local) push(row)
  for (const row of session) push(row)
  for (const row of remote) push(row)
  return out
}

export type { OmniboxKind, OmniboxSuggestion, OmniboxTarget }
export {
  findInstantOmniboxSuggestions,
  findLocalOmniboxSuggestions,
  findRemoteOmniboxSuggestions,
  findSessionOmniboxSuggestions,
  mergeOmniboxSuggestions,
  resolveOmnibox
}
