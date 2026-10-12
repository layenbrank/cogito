/**
 * Provider 配置读写：apiKey 持久化（plugin-store）与运行时配置解析
 *
 * apiKey 明文存于本地 providers.json，桌面单机场景可接受；
 * 后续可迁移 corex keyring，接口不变。
 */
import { LazyStore } from '@tauri-apps/plugin-store'

import { parseModels } from '@/features/agent/model/providers'
import type { ProviderConfig } from '@/features/agent/types'
import type { AgentProvider } from '@/stores/provider'

interface ApiKeyRecord {
  [providerID: string]: string
}

const keyStore = new LazyStore('providers.json', {
  defaults: { apiKeys: {} } as unknown as Record<string, unknown>,
  autoSave: 300
})

async function readApiKeys(): Promise<ApiKeyRecord> {
  await keyStore.init()
  return (await keyStore.get<ApiKeyRecord>('apiKeys')) ?? {}
}

async function readApiKey(providerID: string): Promise<string | null> {
  const keys = await readApiKeys()
  return keys[providerID] ?? null
}

async function writeApiKey(providerID: string, apiKey: string): Promise<void> {
  const keys = await readApiKeys()
  keys[providerID] = apiKey
  await keyStore.init()
  await keyStore.set('apiKeys', keys)
}

async function removeApiKey(providerID: string): Promise<void> {
  const keys = await readApiKeys()
  delete keys[providerID]
  await keyStore.init()
  await keyStore.set('apiKeys', keys)
}

/** 合并 SQLite 元数据与 apiKey，得到会话用配置 */
async function resolveProviderConfig(provider: AgentProvider): Promise<ProviderConfig> {
  const models = parseModels(provider.models)
  const byKind = await readApiKey(provider.kind)
  const byId = provider.id === provider.kind ? null : await readApiKey(provider.id)
  return {
    id: provider.id,
    kind: provider.kind,
    name: provider.name,
    baseUrl: provider.baseUrl || '',
    model: provider.model || models[0] || '',
    apiKey: byKind ?? byId ?? undefined
  }
}

export { readApiKey, writeApiKey, removeApiKey, resolveProviderConfig }
