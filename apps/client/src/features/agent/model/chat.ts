/**
 * chatStream：Agent 对话统一经 goose ACP（sidecar 传输层）。
 * UI 选的是 inventory 供应商，不是「Goose ACP」。
 */
import { findAcpHandle } from '@/features/agent/acp/connection'
import {
  fetchProviderEntry,
  parseConfigFields,
  saveProviderConfig,
  type GooseConfigField
} from '@/features/agent/acp/goose-providers'
import { chatGooseAcp } from '@/features/agent/model/goose-acp'
import { waitGooseReady } from '@/features/agent/acp/session'
import type { AgentToolDefinition, ChatMessage, NormalizedChunk, ProviderConfig } from '@/features/agent/types'

interface ChatParams {
  signal?: AbortSignal
  temperature?: number
  tools?: AgentToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required'
  /** UI 对话 id：绑定独立 goose ActiveSession，防止串话 */
  sessionID?: string
}

interface TestConnectionResult {
  models: string[]
}

async function* chatStream(
  config: ProviderConfig,
  messages: ChatMessage[],
  params: ChatParams = {}
): AsyncGenerator<NormalizedChunk, void, unknown> {
  yield* chatGooseAcp(config, messages, params)
}

/**
 * 连接测试：按 inventory configKeys 写入 goose 并拉取模型（非 readiness，除非调用方自行对 ACP 探测）
 */
async function testConnection(
  config: Pick<ProviderConfig, 'kind' | 'baseUrl' | 'apiKey' | 'model'>,
  fields?: GooseConfigField[]
): Promise<TestConnectionResult> {
  await waitGooseReady()
  const handle = await findAcpHandle()
  const entry = await fetchProviderEntry(handle.connection, config.kind)
  if (!entry) {
    throw new Error(`goose 不认识供应商「${config.kind}」`)
  }

  let saveFields = fields
  if (!saveFields) {
    const values: Record<string, string> = {}
    for (const key of entry.configKeys) {
      if (/HOST|_URL|API_URL/i.test(key.name) && config.baseUrl) {
        values[key.name] = config.baseUrl
      }
      if (key.secret && config.apiKey) {
        values[key.name] = config.apiKey
      }
    }
    saveFields = parseConfigFields(entry.configKeys, values)
  }

  const saved = await saveProviderConfig(handle.connection, config.kind, saveFields)
  return { models: saved.models }
}

export { chatStream, testConnection }
export type { ChatParams, TestConnectionResult }
