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
 *
 * 注意：只写本地 store、不注册 goose，会出现「UI 能选组织模型，切换/发送时 goose 不认识
 * cogito_gateway」——同步目录成功后必须 best-effort 注册，发送前再校验一次。
 */
import { invoke } from '@tauri-apps/api/core'

import { GET_GATEWAY_MODELS, type GatewayModel } from '@/apis/gateway'
import { findAcpHandle } from '@/features/agent/acp/connection'
import { fetchProviderEntry } from '@/features/agent/acp/goose-providers'
import { waitGooseReady } from '@/features/agent/acp/session'
import {
  clearGatewayLabels,
  rememberGatewayLabels
} from '@/features/agent/model/gateway-labels'
import { stringifyModels, parseModels } from '@/features/agent/model/providers'
import { GATEWAY_PROVIDER_KIND } from '@/features/quota/gate'
import { reportCaught } from '@/utils/exception-report'
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

/** 把网关目录写成本地 store 的「组织模型」行；目录空则返回 null。 */
async function upsertCogitoCatalogRow(baseUrl: string, models: string[]): Promise<AgentProvider | null> {
  if (models.length === 0) return null

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

/**
 * 保证本地 provider 表里有与网关目录一致的「组织模型」行；不可用时返回 null。
 *
 * 目录写入成功后会 best-effort 注册 goose（`ensureCogitoProvider`）。goose 未就绪时
 * 仍返回 UI 行，发送路径会再 ensure 一次。
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
    reportCaught('acp.cogito-provider.syncCatalog', error, 'warning')
    clearGatewayLabels()
    await dropStaleCogitoRow()
    return null
  }

  if (models.length === 0) {
    clearGatewayLabels()
    await dropStaleCogitoRow()
    return null
  }

  const row = await upsertCogitoCatalogRow(baseUrl, models)
  if (!row) return null

  try {
    await ensureCogitoProvider()
  } catch (error) {
    // UI 行已可用；goose 注册留给发送/切换模型再试，避免目录同步整段失败。
    // 缺租户是可预期降级（会再补建/提示），不要打 exception-report 刷屏。
    if (isCogitoSoftFailure(error)) {
      console.warn('[acp.cogito-provider.ensureAfterSync]', error)
    } else {
      reportCaught('acp.cogito-provider.ensureAfterSync', error, 'warning')
    }
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
    reportCaught('acp.cogito-provider.dropStaleRow', error, 'warning')
  }
}

async function writeGooseProvider(tenantID: string, baseUrl: string, models: string[], force: boolean) {
  return invoke<boolean>(CHANNELS.COGITO.PROVIDER_ENSURE, {
    tenantID,
    baseUrl,
    models,
    force
  })
}

type GooseCogitoStatus = 'ready' | 'missing' | 'unknown'

/**
 * 查 goose inventory 是否已挂上组织模型供应商。
 * `unknown`：goose/ACP 暂时不可用 —— 与「确认缺失」区分，避免误强制重启。
 */
async function findGooseCogitoStatus(): Promise<GooseCogitoStatus> {
  try {
    await waitGooseReady()
    const handle = await findAcpHandle()
    const entry = await fetchProviderEntry(handle.connection, COGITO_PROVIDER_ID)
    return entry ? 'ready' : 'missing'
  } catch (error) {
    reportCaught('acp.cogito-provider.findGooseCogitoStatus', error, 'warning')
    return 'unknown'
  }
}

/** 组织模型不可用时的软失败（预期降级，勿 exception-report） */
const COGITO_SOFT_ERROR = 'CogitoSoftFailure'

function softFailure(message: string): Error {
  const error = new Error(message)
  error.name = COGITO_SOFT_ERROR
  return error
}

function isCogitoSoftFailure(error: unknown): boolean {
  return error instanceof Error && error.name === COGITO_SOFT_ERROR
}

/**
 * 幂等注册 cogito provider。三个入参任何一个变了，Rust 侧都会重写 JSON 并重启 goose。
 *
 * 缺租户 / 缺端点 / 模型目录空 → 抛软失败，由发送路径 yield 可读错误（不 Uncaught）。
 * 注册后若 goose inventory **确认**没有 `cogito_gateway`，强制重启再验一次；
 * ACP 暂时不可用则直接报错，不连环重启。
 */
async function ensureCogitoProvider(): Promise<void> {
  // 无缓存租户时 sync 会跳过「空结果新鲜度」并尝试补建 PERSONAL
  const tenantID = (await syncActiveTenant()) ?? findActiveTenantID()
  if (!tenantID) {
    await dropStaleCogitoRow()
    throw softFailure(
      '组织模型暂不可用：未解析到个人租户。请重新登录，或检查思考服务是否可达后再试'
    )
  }
  const baseUrl = findGatewayBaseURL()
  if (!baseUrl) {
    await dropStaleCogitoRow()
    throw softFailure('组织模型暂不可用：未配置思考服务地址')
  }
  const models = await findGatewayModels()
  if (models.length === 0) {
    await dropStaleCogitoRow()
    throw softFailure('组织模型暂不可用：网关模型目录为空，请联系管理员启用模型')
  }

  await writeGooseProvider(tenantID, baseUrl, models, false)

  let status = await findGooseCogitoStatus()
  if (status === 'missing') {
    await writeGooseProvider(tenantID, baseUrl, models, true)
    status = await findGooseCogitoStatus()
  }

  if (status === 'ready') {
    try {
      await upsertCogitoCatalogRow(baseUrl, models)
    } catch (error) {
      reportCaught('acp.cogito-provider.upsertAfterEnsure', error, 'warning')
    }
    return
  }

  if (status === 'unknown') {
    throw softFailure('组织模型暂不可用：goose serve 未就绪，请稍后重试')
  }

  throw softFailure(
    `组织模型暂不可用：goose 无法载入供应商（${COGITO_PROVIDER_ID}）。请确认已登录且思考服务可用后重试`
  )
}

/** 租户切换：只更新 `X-Tenant-ID` 头（Rust 侧幂等，没变不重启）。 */
async function setCogitoTenant(tenantID: string): Promise<void> {
  try {
    await invoke<boolean>(CHANNELS.COGITO.PROVIDER_SET_TENANT, { tenantID })
  } catch (error) {
    reportCaught('acp.cogito-provider.setTenant', error, 'warning')
  }
}

export {
  COGITO_PROVIDER_ID,
  COGITO_PROVIDER_NAME,
  ensureCogitoProvider,
  isCogitoSoftFailure,
  setCogitoTenant,
  syncCogitoGatewayCatalog
}
