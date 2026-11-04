/**
 * 可选向量检索配置（默认关闭，对齐 llm_wiki Embedding）。
 *
 * 与旧版的差异：多了 `probeBeforeEnable` / `lastProbe` —— 打开开关前先探一次
 * `/embeddings`，端点填错时**不落 enabled=true**，避免「一开就整库 embedding、
 * 一 embed 就卡死」。
 */
const STORAGE_KEY = 'knowledge.embedding.config'

type EmbeddingStore = 'lancedb' | 'json'

/** 一次端点探测的结果（设置页展示 + 上报用）。 */
interface EmbeddingProbe {
  at: number
  ok: boolean
  /** 返回向量的维度；`ok=false` 时为空 */
  dim?: number
  error?: string
}

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
  /** 启用前先探测端点（默认 true） */
  probeBeforeEnable: boolean
  /** 最近一次探测结果 */
  lastProbe: EmbeddingProbe | null
}

const EMBEDDING_DEFAULTS: EmbeddingConfig = {
  enabled: false,
  store: 'lancedb',
  endpoint: '',
  apiKey: '',
  model: 'text-embedding-3-small',
  maxChunkChars: 1200,
  overlapChunkChars: 200,
  // 写路径默认串行：Lance 同一张表的 delete+add 并发会互踩（见 vectorstore.rs 注释）
  concurrency: 1,
  batchSize: 16,
  embedOnIngest: true,
  probeBeforeEnable: true,
  lastProbe: null
}

function parseProbe(raw: unknown): EmbeddingProbe | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<EmbeddingProbe>
  if (typeof value.at !== 'number' || typeof value.ok !== 'boolean') return null
  return {
    at: value.at,
    ok: value.ok,
    dim: typeof value.dim === 'number' ? value.dim : undefined,
    error: typeof value.error === 'string' ? value.error.slice(0, 500) : undefined
  }
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
      probeBeforeEnable: parsed.probeBeforeEnable !== false,
      lastProbe: parseProbe(parsed.lastProbe),
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

/**
 * 打开/关闭 embedding 开关的决策。
 *
 * 抽成纯函数是为了让「端点没填、探测失败 → 绝不落 `enabled=true`」这条不变式
 * 可以被单测锁住：旧版开关「写 localStorage 就完事」，端点填错时下一次 ingest
 * 立刻全量 embedding，用户看到的就是「一点就卡死、整机跟着崩」。
 */
type EmbeddingTogglePlan =
  | { kind: 'disable' }
  | { kind: 'reject'; message: string }
  | { kind: 'enable' }
  | { kind: 'probe' }

function planEmbeddingToggle(input: {
  checked: boolean
  endpoint: string
  probeBeforeEnable: boolean
}): EmbeddingTogglePlan {
  if (!input.checked) return { kind: 'disable' }
  if (!input.endpoint.trim()) return { kind: 'reject', message: '先填 embedding 端点，再启用' }
  if (!input.probeBeforeEnable) return { kind: 'enable' }
  return { kind: 'probe' }
}

/** 探测失败要写的补丁：`enabled` 恒为 false —— 端点不可达时开关不生效。 */
function embeddingProbeFailurePatch(error: unknown, at: number): Partial<EmbeddingConfig> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
  return { enabled: false, lastProbe: { at, ok: false, error: message } }
}

/** 探测成功要写的补丁：这时才允许 `enabled=true`，并记下维度。 */
function embeddingProbeSuccessPatch(dim: number, at: number): Partial<EmbeddingConfig> {
  return { enabled: true, lastProbe: { at, ok: true, dim } }
}

export {
  EMBEDDING_DEFAULTS,
  embeddingProbeFailurePatch,
  embeddingProbeSuccessPatch,
  patchEmbeddingConfig,
  planEmbeddingToggle,
  readEmbeddingConfig,
  writeEmbeddingConfig
}
export type { EmbeddingConfig, EmbeddingProbe, EmbeddingStore, EmbeddingTogglePlan }
