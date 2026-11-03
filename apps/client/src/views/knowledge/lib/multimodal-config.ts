/**
 * 多模态配图描述（对齐 llm_wiki Multimodal；ingest PDF 图片时用）。
 */
const STORAGE_KEY = 'knowledge.multimodal.config'

interface MultimodalConfig {
  enabled: boolean
  /** true = 复用全局 Agent 视觉能力说明；独立 endpoint 预留 */
  useMainLlm: boolean
  endpoint: string
  apiKey: string
  model: string
}

const MULTIMODAL_DEFAULTS: MultimodalConfig = {
  enabled: false,
  useMainLlm: true,
  endpoint: '',
  apiKey: '',
  model: ''
}

function readMultimodalConfig(): MultimodalConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...MULTIMODAL_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<MultimodalConfig>
    return { ...MULTIMODAL_DEFAULTS, ...parsed, enabled: Boolean(parsed.enabled) }
  } catch (error) {
    console.warn('[multimodal-config] read failed', error)
    return { ...MULTIMODAL_DEFAULTS }
  }
}

function writeMultimodalConfig(config: MultimodalConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('[multimodal-config] write failed', error)
  }
}

function patchMultimodalConfig(patch: Partial<MultimodalConfig>): MultimodalConfig {
  const next = { ...readMultimodalConfig(), ...patch }
  writeMultimodalConfig(next)
  return next
}

export { MULTIMODAL_DEFAULTS, patchMultimodalConfig, readMultimodalConfig, writeMultimodalConfig }
export type { MultimodalConfig }
