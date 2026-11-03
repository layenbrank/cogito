/**
 * Deep Research / 外部搜索 provider 配置（对齐 llm_wiki Web Search）。
 */
const STORAGE_KEY = 'knowledge.web-search.config'

type SearchProvider =
  | 'none'
  | 'tavily'
  | 'serpapi'
  | 'searxng'
  | 'brave'
  | 'firecrawl'
  | 'bocha'

interface WebSearchConfig {
  provider: SearchProvider
  apiKey: string
  endpoint: string
  /** Research 写入 raw 后是否自动入 ingest */
  autoIngest: boolean
}

const WEB_SEARCH_DEFAULTS: WebSearchConfig = {
  provider: 'none',
  apiKey: '',
  endpoint: '',
  autoIngest: true
}

function readWebSearchConfig(): WebSearchConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...WEB_SEARCH_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<WebSearchConfig>
    return { ...WEB_SEARCH_DEFAULTS, ...parsed }
  } catch (error) {
    console.warn('[web-search-config] read failed', error)
    return { ...WEB_SEARCH_DEFAULTS }
  }
}

function writeWebSearchConfig(config: WebSearchConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('[web-search-config] write failed', error)
  }
}

function patchWebSearchConfig(patch: Partial<WebSearchConfig>): WebSearchConfig {
  const next = { ...readWebSearchConfig(), ...patch }
  writeWebSearchConfig(next)
  return next
}

export {
  WEB_SEARCH_DEFAULTS,
  patchWebSearchConfig,
  readWebSearchConfig,
  writeWebSearchConfig
}
export type { SearchProvider, WebSearchConfig }
