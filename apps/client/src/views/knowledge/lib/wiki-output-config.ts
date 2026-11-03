/**
 * Wiki 输出偏好（对齐 llm_wiki Output）。
 */
const STORAGE_KEY = 'knowledge.wiki-output.config'

interface WikiOutputConfig {
  /** ingest / 生成正文语言 */
  language: 'zh-CN' | 'en' | 'ja' | 'ko'
}

const WIKI_OUTPUT_DEFAULTS: WikiOutputConfig = {
  language: 'zh-CN'
}

function readWikiOutputConfig(): WikiOutputConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...WIKI_OUTPUT_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<WikiOutputConfig>
    return { ...WIKI_OUTPUT_DEFAULTS, ...parsed }
  } catch (error) {
    console.warn('[wiki-output-config] read failed', error)
    return { ...WIKI_OUTPUT_DEFAULTS }
  }
}

function writeWikiOutputConfig(config: WikiOutputConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('[wiki-output-config] write failed', error)
  }
}

function patchWikiOutputConfig(patch: Partial<WikiOutputConfig>): WikiOutputConfig {
  const next = { ...readWikiOutputConfig(), ...patch }
  writeWikiOutputConfig(next)
  return next
}

export { WIKI_OUTPUT_DEFAULTS, patchWikiOutputConfig, readWikiOutputConfig, writeWikiOutputConfig }
export type { WikiOutputConfig }
