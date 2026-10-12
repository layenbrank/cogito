/**
 * Provider 工具：模型列表序列化；Ollama 直连默认地址
 */
const OLLAMA_BASE_URL = 'http://localhost:11434'

function parseModels(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch (error) {
    console.warn('[agent-providers] 模型列表存档损坏，回落空列表:', error)
    return []
  }
}

function stringifyModels(models: string[]): string {
  return JSON.stringify(models)
}

export { OLLAMA_BASE_URL, parseModels, stringifyModels }
