/**
 * cogito 网关 provider 的注册（PR5 provider bootstrap）+ 渲染进程目录镜像。
 *
 * goose 1.54 的 ACP `custom/create` 不暴露 `auth.command`，所以由 Rust 侧直接写 goose 的
 * 声明式 `custom_providers/cogito_gateway.json`（见 `src-tauri/utils/cogito_provider.rs`），
 * 必要时重启 goose 重读。
 *
 * 渲染进程的模型选择器读的是本地 `useProviderStore`，不会自己打 `/gateway/models`。
 * 因此除了注册 goose，还要把服务端目录同步成 store 里固定的一行（`cogito_gateway`），
 * 否则后台配了模型，对话里仍然「没有可用模型」。
 */
import { invoke } from '@tauri-apps/api/core'

import { GET_GATEWAY_MODELS, type GatewayModel } from '@/apis/gateway'
import {
  clearGatewayLabels,
  rememberGatewayLabels
} from '@/features/agent/model/gateway-labels'
import { stringifyModels, parseModels } from '@/features/agent/model/providers'
import { GATEWAY_PROVIDER_KIND } from '@/features/quota/gate'
import { syncActiveTenant } from '@/features/quota/tenant'
import { CHANNELS } from '@/shared/ipc/channels'
import { useProviderStore, type AgentProvider } from '@/stores/provider'
import { findAuthToken } from '@/utils/auth'
import { ENV_URLS } from '@/utils/http/env'
import { findActiveTenantID } from '@/utils/tenant'

const GATEWAY_CHAT_PATH = '/api/v1/gateway/chat/completions'
const MODELS_TTL_MS = 5 * 60_000
/** 平台行在 provider 表里的固定 id（与 goose providerId / Rust PROVIDER_ID 一致） */
const COGITO_PROVIDER_ID = GATEWAY_PROVIDER_KIND
const COGITO_PROVIDER_NAME = '组织模型'

let modelsCache: { at: number; models: string[] } | null = null

function findGatewayBaseURL(): string | null {
  const base = ENV_URLS.thinking?.trim()
  if (!base) return null
  return `${base.replace(/\/+$/, '')}${GATEWAY_CHAT_PATH}`
}

function rememberCatalog(catalog: GatewayModel[]): string[] {
  const models = catalog.map(function (model) {
    return model.name
  })
  rememberGatewayLabels(catalog)
  // 空目录不缓存：管理员刚配完模型时不应被 5 分钟空结果挡住
  modelsCache = models.length > 0 ? { at: Date.now(), models } : null
  return models
}

/** 网关模型目录：目录里的 `name` 就是 goose provider 要挂的模型名。带 5 分钟缓存。 */
async function findGatewayModels(): Promise<string[]> {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models
  const list = await GET_GATEWAY_MODELS()
  return rememberCatalog(list)
}

function findCogitoRow(providers: AgentProvider[]): AgentProvider | null {
  return (
    providers.find(function (provider) {
      return provider.id === COGITO_PROVIDER_ID || provider.kind === COGITO_PROVIDER_ID
    }) ?? null
  )
}

function isCogitoRowCurrent(row: AgentProvider, baseUrl: string, models: string[]): boolean {
  return (
    row.kind === COGITO_PROVIDER_ID &&
    row.name === COGITO_PROVIDER_NAME &&
    row.baseUrl === baseUrl &&
    row.enabled &&
    JSON.stringify(parseModels(row.models)) === JSON.stringify(models)
  )
}

/**
 * 保证本地 provider 表里有与网关目录一致的「组织模型」行；不可用时返回 null。
 *
 * 只写本地 store（选择器用），goose 注册仍由 `ensureCogitoProvider` 在发送前做。
 * 未登录 / 未配置服务地址 / 目录空 → 停用或移除幽灵行，避免 picker 选中后发送失败。
 */
async function syncCogitoGatewayCatalog(): Promise<AgentProvider | null> {
  const store = useProviderStore.getState()
  if (!store.providersLoaded) await store.toReadProviders()

  const baseUrl = findGatewayBaseURL()
  if (!baseUrl || !findAuthToken()) {
    clearGatewayLabels()
    await dropStaleCogitoRow()
    return null
  }

  let models: string[]
  try {
    models = await findGatewayModels()
  } catch (error) {
    console.warn('[acp/cogito-provider] 拉取网关目录失败:', error)
    clearGatewayLabels()
    await dropStaleCogitoRow()
    return null
  }

  if (models.length === 0) {
    clearGatewayLabels()
    await dropStaleCogitoRow()
    return null
  }

  const current = findCogitoRow(useProviderStore.getState().providers)
  if (current && isCogitoRowCurrent(current, baseUrl, models) && current.id === COGITO_PROVIDER_ID) {
    return current
  }

  const keepModel =
    current?.model && models.includes(current.model) ? current.model : (models[0] ?? null)
  const now = Date.now()
  const row: AgentProvider = {
    id: COGITO_PROVIDER_ID,
    kind: COGITO_PROVIDER_ID,
    name: COGITO_PROVIDER_NAME,
    baseUrl,
    models: stringifyModels(models),
    model: keepModel,
    enabled: true,
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  }

  if (current && current.id !== COGITO_PROVIDER_ID) {
    await useProviderStore.getState().toRemoveProvider([current.id])
  }

  const existing = findCogitoRow(useProviderStore.getState().providers)
  if (existing && existing.id === COGITO_PROVIDER_ID) {
    await useProviderStore.getState().toUpdateProvider([
      {
        id: COGITO_PROVIDER_ID,
        kind: row.kind,
        name: row.name,
        baseUrl: row.baseUrl,
        models: row.models,
        model: row.model,
        enabled: true,
        updatedAt: now
      }
    ])
  } else {
    await useProviderStore.getState().toWriteProvider([row])
  }

  return findCogitoRow(useProviderStore.getState().providers)
}

/** 未登录 / 目录空时滤掉幽灵组织行 */
async function dropStaleCogitoRow(): Promise<void> {
  const store = useProviderStore.getState()
  const row = findCogitoRow(store.providers)
  if (!row) return
  try {
    await store.toRemoveProvider([row.id])
  } catch (error) {
    console.warn('[acp/cogito-provider] 清理幽灵组织模型行失败:', error)
  }
}

/**
 * 幂等注册 cogito provider。三个入参任何一个变了，Rust 侧都会重写 JSON 并重启 goose。
 *
 * 缺租户 / 缺端点 / 模型目录空 → 抛错，由发送路径中止并提示「网关未就绪」。
 */
async function ensureCogitoProvider(): Promise<void> {
  const tenantID = (await syncActiveTenant()) ?? findActiveTenantID()
  if (!tenantID) throw new Error('未解析到租户，无法注册网关 provider')
  const baseUrl = findGatewayBaseURL()
  if (!baseUrl) throw new Error('未配置思考服务地址，无法注册网关 provider')
  const models = await findGatewayModels()
  if (models.length === 0) throw new Error('网关模型目录为空，无法注册 provider')
  await invoke<boolean>(CHANNELS.COGITO.PROVIDER_ENSURE, { tenantID, baseUrl, models })
  // 发送前顺手把选择器那一行对齐，避免目录变了 UI 还停在旧清单
  void syncCogitoGatewayCatalog().catch(function (error) {
    console.warn('[acp/cogito-provider] 同步组织模型行失败:', error)
  })
}

/** 租户切换：只更新 `X-Tenant-ID` 头（Rust 侧幂等，没变不重启）。 */
async function setCogitoTenant(tenantID: string): Promise<void> {
  try {
    await invoke<boolean>(CHANNELS.COGITO.PROVIDER_SET_TENANT, { tenantID })
  } catch (error) {
    console.warn('[acp/cogito-provider] 更新网关租户失败:', error)
  }
}

export {
  COGITO_PROVIDER_ID,
  COGITO_PROVIDER_NAME,
  ensureCogitoProvider,
  setCogitoTenant,
  syncCogitoGatewayCatalog
}
