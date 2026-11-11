import { type GooseProviderEntry } from '@/features/agent/acp/goose-providers'
import { stringifyModels } from '@/features/agent/model/providers'
import { useProviderStore, type AgentProvider } from '@/stores/provider'

function findHostValue(values: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(values)) {
    if (!value.trim()) continue
    if (/HOST|_URL|API_URL/i.test(key)) return value.trim()
  }
  return null
}

interface UpsertOptions {
  /**
   * 用户主动保存：置为启用。
   *
   * bootstrap（设置页每次打开）的刷新**不能**替用户做这个决定 —— 否则一个手动停用的
   * 接入会被刷回来，模型选择器与路由都被这条幽灵行影响。
   */
  enable?: boolean
}

async function upsertStoreProvider(
  entry: GooseProviderEntry,
  values: Record<string, string>,
  options: UpsertOptions = {}
): Promise<void> {
  const store = useProviderStore.getState()
  const existing = store.providers.find(function (provider) {
    return provider.id === entry.providerId || provider.kind === entry.providerId
  })
  const models = entry.models
  const keepModel =
    existing?.model && models.includes(existing.model)
      ? existing.model
      : entry.defaultModel && models.includes(entry.defaultModel)
        ? entry.defaultModel
        : (models[0] ?? null)
  const baseUrl = findHostValue(values) ?? existing?.baseUrl ?? null
  const now = Date.now()

  if (existing && existing.id !== entry.providerId) {
    await store.toRemoveProvider([existing.id])
  } else if (existing) {
    await store.toUpdateProvider([
      {
        id: existing.id,
        kind: entry.providerId,
        name: entry.providerName,
        baseUrl,
        models: stringifyModels(models),
        model: keepModel,
        enabled: options.enable ?? existing.enabled,
        updatedAt: now
      }
    ])
    return
  }

  const stillThere = store.providers.some(function (provider) {
    return provider.id === entry.providerId
  })
  if (stillThere) {
    const kept = store.providers.find(function (provider) {
      return provider.id === entry.providerId
    })
    await store.toUpdateProvider([
      {
        id: entry.providerId,
        kind: entry.providerId,
        name: entry.providerName,
        baseUrl,
        models: stringifyModels(models),
        model: keepModel,
        enabled: options.enable ?? kept?.enabled ?? entry.configured,
        updatedAt: now
      }
    ])
    return
  }

  const row: AgentProvider = {
    id: entry.providerId,
    kind: entry.providerId,
    name: entry.providerName,
    baseUrl,
    models: stringifyModels(models),
    model: keepModel,
    enabled: options.enable ?? entry.configured,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  await store.toWriteProvider([row])
}

export { findHostValue, upsertStoreProvider }
