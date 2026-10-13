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

async function upsertStoreProvider(
  entry: GooseProviderEntry,
  values: Record<string, string>
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
        enabled: true,
        updatedAt: now
      }
    ])
    return
  }

  const stillThere = store.providers.some(function (provider) {
    return provider.id === entry.providerId
  })
  if (stillThere) {
    await store.toUpdateProvider([
      {
        id: entry.providerId,
        kind: entry.providerId,
        name: entry.providerName,
        baseUrl,
        models: stringifyModels(models),
        model: keepModel,
        enabled: true,
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
    enabled: entry.configured,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  await store.toWriteProvider([row])
}

export { findHostValue, upsertStoreProvider }
