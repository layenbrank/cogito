/**
 * cogito 网关 provider 的注册（PR5 provider bootstrap）。
 *
 * goose 1.54 的 ACP `custom/create` 不暴露 `auth.command`，所以由 Rust 侧直接写 goose 的
 * 声明式 `custom_providers/cogito_gateway.json`（见 `src-tauri/utils/cogito_provider.rs`），
 * 必要时重启 goose 重读。
 *
 * 这里只负责攒齐三个入参（租户 / 网关 chat 端点 / 模型目录）并发起**幂等**注册：
 * 入参没变就不重启，发消息前调一次几乎零成本。
 */
import { invoke } from '@tauri-apps/api/core'

import { GET_GATEWAY_MODELS } from '@/apis/gateway'
import { syncActiveTenant } from '@/features/quota/tenant'
import { CHANNELS } from '@/shared/ipc/channels'
import { ENV_URLS } from '@/utils/http/env'
import { findActiveTenantID } from '@/utils/tenant'

const GATEWAY_CHAT_PATH = '/api/v1/gateway/chat/completions'
const MODELS_TTL_MS = 5 * 60_000

let modelsCache: { at: number; models: string[] } | null = null

/** 网关模型目录：目录里的 `name` 就是 goose provider 要挂的模型名。带 5 分钟缓存。 */
async function findGatewayModels(): Promise<string[]> {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models
  const list = await GET_GATEWAY_MODELS()
  const models = list.map(function (model) {
    return model.name
  })
  modelsCache = { at: Date.now(), models }
  return models
}

/**
 * 幂等注册 cogito provider。三个入参任何一个变了，Rust 侧都会重写 JSON 并重启 goose。
 *
 * 缺租户 / 缺端点 / 模型目录空 → 抛错，由发送路径中止并提示「网关未就绪」。
 */
async function ensureCogitoProvider(): Promise<void> {
  const tenantID = (await syncActiveTenant()) ?? findActiveTenantID()
  if (!tenantID) throw new Error('未解析到租户，无法注册网关 provider')
  const base = ENV_URLS.thinking?.trim()
  if (!base) throw new Error('未配置思考服务地址，无法注册网关 provider')
  const baseUrl = `${base.replace(/\/+$/, '')}${GATEWAY_CHAT_PATH}`
  const models = await findGatewayModels()
  if (models.length === 0) throw new Error('网关模型目录为空，无法注册 provider')
  await invoke<boolean>(CHANNELS.COGITO.PROVIDER_ENSURE, { tenantID, baseUrl, models })
}

/** 租户切换：只更新 `X-Tenant-ID` 头（Rust 侧幂等，没变不重启）。 */
async function setCogitoTenant(tenantID: string): Promise<void> {
  try {
    await invoke<boolean>(CHANNELS.COGITO.PROVIDER_SET_TENANT, { tenantID })
  } catch (error) {
    console.warn('[acp/cogito-provider] 更新网关租户失败:', error)
  }
}

export { ensureCogitoProvider, setCogitoTenant }
