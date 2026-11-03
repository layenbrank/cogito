/**
 * 可选向量检索配置（默认关闭，对齐 llm_wiki Embedding）。
 */
const STORAGE_KEY = 'knowledge.embedding.config'

type EmbeddingStore = 'lancedb' | 'json'

interface EmbeddingConfig {
  enabled: boolean
  /** 持久层：LanceDB（库目录 .cogito/lancedb）或 JSON 回退 */
  store: EmbeddingStore
  endpoint: string
  apiKey: string
  model: string
  maxChunkChars: number
  overlapChunkChars: number
  concurrency: number
  batchSize: number
  /** ingest 成功后自动 embed */
  embedOnIngest: boolean
}

const EMBEDDING_DEFAULTS: EmbeddingConfig = {
  enabled: false,
  store: 'lancedb',
  endpoint: '',
  apiKey: '',
  model: 'text-embedding-3-small',
  maxChunkChars: 1200,
  overlapChunkChars: 200,
  concurrency: 2,
  batchSize: 16,
  embedOnIngest: true
}

function readEmbeddingConfig(): EmbeddingConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMBEDDING_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<EmbeddingConfig>
    return {
      ...EMBEDDING_DEFAULTS,
      ...parsed,
      enabled: Boolean(parsed.enabled),
      store: parsed.store === 'json' ? 'json' : 'lancedb',
      embedOnIngest: parsed.embedOnIngest !== false,
      maxChunkChars: Math.max(200, Number(parsed.maxChunkChars) || EMBEDDING_DEFAULTS.maxChunkChars),
      overlapChunkChars: Math.max(
        0,
        Number(parsed.overlapChunkChars) || EMBEDDING_DEFAULTS.overlapChunkChars
      ),
      concurrency: Math.max(1, Math.min(8, Number(parsed.concurrency) || EMBEDDING_DEFAULTS.concurrency)),
      batchSize: Math.max(1, Math.min(64, Number(parsed.batchSize) || EMBEDDING_DEFAULTS.batchSize))
    }
  } catch (error) {
    console.warn('[embedding-config] read failed', error)
    return { ...EMBEDDING_DEFAULTS }
  }
}

function writeEmbeddingConfig(config: EmbeddingConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('[embedding-config] write failed', error)
  }
}

function patchEmbeddingConfig(patch: Partial<EmbeddingConfig>): EmbeddingConfig {
  const next = { ...readEmbeddingConfig(), ...patch }
  writeEmbeddingConfig(next)
  return next
}

export { EMBEDDING_DEFAULTS, patchEmbeddingConfig, readEmbeddingConfig, writeEmbeddingConfig }
export type { EmbeddingConfig, EmbeddingStore }
