/**
 * 知识库对话检索模式（对齐 llm_wiki standard / smart / faithful）。
 */
const RETRIEVAL_MODE_KEY = 'knowledge.wiki.retrievalMode'

type RetrievalMode = 'standard' | 'smart' | 'faithful'

interface RetrievalModeOption {
  id: RetrievalMode
  label: string
  hint: string
}

const RETRIEVAL_MODE_OPTIONS: readonly RetrievalModeOption[] = [
  {
    id: 'standard',
    label: '标准',
    hint: '本地 FTS（app_knowledge_search）'
  },
  {
    id: 'smart',
    label: '智能',
    hint: 'FTS + 先读 overview；若开启 embedding 可再混合向量'
  },
  {
    id: 'faithful',
    label: '忠实原文',
    hint: '优先 raw/sources 与带 sources[] 的页；回答必须引用路径'
  }
]

function isRetrievalMode(value: string): value is RetrievalMode {
  return value === 'standard' || value === 'smart' || value === 'faithful'
}

function readRetrievalMode(): RetrievalMode {
  if (typeof window === 'undefined') return 'standard'
  try {
    const raw = window.localStorage.getItem(RETRIEVAL_MODE_KEY)
    if (raw && isRetrievalMode(raw)) return raw
  } catch (error) {
    console.warn('[retrieval-mode] read failed:', error)
  }
  return 'standard'
}

const RETRIEVAL_MODE_EVENT = 'knowledge-retrieval-mode'

function writeRetrievalMode(mode: RetrievalMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RETRIEVAL_MODE_KEY, mode)
    window.dispatchEvent(new CustomEvent(RETRIEVAL_MODE_EVENT, { detail: mode }))
  } catch (error) {
    console.warn('[retrieval-mode] write failed:', error)
  }
}

function findRetrievalModeHint(mode: RetrievalMode): string {
  switch (mode) {
    case 'smart':
      return '检索模式=smart：先 app_knowledge_read_wiki 读 wiki/overview.md，再用 app_knowledge_search；需要关系时用 app_knowledge_graph_search。'
    case 'faithful':
      return '检索模式=faithful：优先查 raw/sources 与 frontmatter 含 sources[] 的页；结论必须标注来源路径，禁止无依据推断。'
    default:
      return '检索模式=standard：用 app_knowledge_search 做 FTS，命中后再 read。'
  }
}

export {
  RETRIEVAL_MODE_KEY,
  RETRIEVAL_MODE_EVENT,
  RETRIEVAL_MODE_OPTIONS,
  findRetrievalModeHint,
  isRetrievalMode,
  readRetrievalMode,
  writeRetrievalMode,
  type RetrievalMode,
  type RetrievalModeOption
}
