import { GATEWAY_PROVIDER_KIND, type ModelEntry } from '@cogito/agent/provider'
import type { ChatTarget } from '@cogito/chat/ports'

import { GET_GATEWAY_MODELS, type GatewayModel } from '@/apis/gateway.ts'
import type { ProviderRow } from '@/features/chat/provider/row.ts'
import { findAuthToken } from '@/utils/auth.ts'

/**
 * 平台网关接入：把 service 的 AI 网关（`/api/v1/gateway/*`）变成 provider 表里的**一行**。
 *
 * 为什么是一行而不是一条通路：网关就是个 OpenAI 兼容端点，跟 Ollama 没有形状差别 ——
 * 差别只在**凭据从哪来**（登录令牌 vs 钥匙串里的 BYOK 密钥）与**模型谁定**（服务端目录 vs
 * 用户手填）。这两点分别由 `kind: 'gateway'` 与 `models` 表达，于是发送链路只有一条：
 * 主进程按 providerID 解析出连接（见 `host/capabilities/assistant/model.ts`），
 * 在线模型因此和本地模型共用工具、审批、计划、用量全套能力。
 *
 * 平台行用固定 id（不是 uuid），生命周期与用户自建的 BYOK 行不同：
 * 内容由服务端目录决定，所以**每次发送前同步一次**（`ensurePlatformProvider`），
 * 而不是让用户去表单里维护。用户在设置页对它是只读的。
 */

/** 平台行在 provider 表里的固定 id（内置行，用户不可改） */
const PLATFORM_PROVIDER_ID = 'platform-gateway'

/** 平台行的展示名；两处分组用同一份文案，避免「组织模型」和「平台模型」两个说法 */
const PLATFORM_PROVIDER_NAME = '组织模型'

/**
 * 网关根地址：服务地址（构建时的 `VITE_COGITO`，含 URI 版本前缀）+ `/gateway`。
 * 补全与目录都挂在它下面，与管理面共用同一份 base。
 */
function findGatewayBaseURL(): string | null {
  const base = (import.meta.env.VITE_COGITO ?? '').trim()
  return base ? `${base.replace(/\/+$/, '')}/gateway` : null
}

/** 平台模型不可用的原因；可用时 null（给 picker 与设置页显示同一句人话） */
function findPlatformBlocker(): string | null {
  if (!findGatewayBaseURL()) return '未配置服务地址（构建时的 VITE_COGITO）'
  if (!findAuthToken()) return '未登录'
  return null
}

/**
 * 发送闸门用的说法：同一条原因多补一句「怎么办」。
 *
 * 与 picker 分开是因为这行字会作为**消息**出现在聊天里，用户得知道下一步；
 * 而 picker 只有一行的空间。
 */
function findPlatformSendBlocker(): string | null {
  if (!findGatewayBaseURL()) return '平台模型不可用：这次构建没有配置服务地址（VITE_COGITO）。'
  if (!findAuthToken()) return '平台模型需要登录：请先登录后再发送，或改用本地 / BYOK 模型。'
  return null
}

/** 这条运行目标是不是平台行。缓存没命中（热更、新模块图）时也是对的 —— 凭据不该由缓存决定 */
function isPlatformTarget(target: ChatTarget | null | undefined): boolean {
  return target?.providerID === PLATFORM_PROVIDER_ID
}

function isPlatformReady(): boolean {
  return findPlatformBlocker() === null
}

/**
 * 服务端目录 → 声明态模型清单。
 *
 * `name` 才是请求里 `model` 字段要的值，所以它当 `id`；`label` 是给人看的名字。
 * 能力与上下文窗口服务端给多少就落多少，缺的交给契约兜底（见 `@cogito/agent/provider`）。
 */
function toPlatformModels(catalog: GatewayModel[]): ModelEntry[] {
  return catalog.map(function (item) {
    const entry: ModelEntry = { id: item.name, name: item.label || item.name }

    if (item.capabilities) entry.capabilities = item.capabilities
    if (item.contextWindow) entry.limit = { context: item.contextWindow }
    if (item.providerName) entry.providerName = item.providerName

    return entry
  })
}

/** 从一份 provider 清单里挑出平台行（纯函数；调用方通常已经有清单了） */
function findPlatformRow(providers: ProviderRow[]): ProviderRow | null {
  return (
    providers.find(function (provider) {
      return provider.id === PLATFORM_PROVIDER_ID
    }) ?? null
  )
}

async function readPlatformRow(): Promise<ProviderRow | null> {
  return findPlatformRow(await itc.chat.provider.toRead())
}

/**
 * 滤掉不可用的平台行。
 *
 * 平台行是服务端目录的镜像，落库后不会因为退出登录而消失 —— 未登录 / 未配置服务地址时，
 * 它就是上一次登录留下的幽灵：模型清单还在，凭据没了。选择链路必须在读入口就把它滤掉，
 * 否则「自动」（组织模型优先）会挑中它，发送必然失败。
 */
function dropStalePlatformRow(providers: ProviderRow[]): ProviderRow[] {
  if (isPlatformReady()) return providers

  return providers.filter(function (provider) {
    return provider.id !== PLATFORM_PROVIDER_ID
  })
}

/** 平台行是否已经跟这份目录一致（一致就不写库，省掉每次发送一次 IPC 写） */
function isPlatformRowCurrent(row: ProviderRow, baseUrl: string, models: ModelEntry[]): boolean {
  return (
    row.kind === GATEWAY_PROVIDER_KIND &&
    row.name === PLATFORM_PROVIDER_NAME &&
    row.baseUrl === baseUrl &&
    row.enabled &&
    JSON.stringify(row.models ?? []) === JSON.stringify(models)
  )
}

/**
 * 保证平台行存在、且与网关目录一致；网关不可用时返回 null（不落库）。
 *
 * 只在**真正要发送前**调用：picker 的模型清单直接读服务端目录，不依赖这一行，
 * 所以这里不参与任何 queryFn —— 否则「读 → 写 → 失效 → 再读」会自激。
 */
async function ensurePlatformProvider(): Promise<ProviderRow | null> {
  const baseUrl = findGatewayBaseURL()
  if (!baseUrl || !findAuthToken()) return null

  const catalog = await GET_GATEWAY_MODELS()
  const models = toPlatformModels(catalog)
  const current = await readPlatformRow()
  if (current && isPlatformRowCurrent(current, baseUrl, models)) return current

  const payload = {
    id: PLATFORM_PROVIDER_ID,
    kind: GATEWAY_PROVIDER_KIND,
    name: PLATFORM_PROVIDER_NAME,
    baseUrl,
    models,
    model: null,
    enabled: true
  }

  return current ? itc.chat.provider.toUpdate(payload) : itc.chat.provider.toWrite(payload)
}

export {
  dropStalePlatformRow,
  ensurePlatformProvider,
  findGatewayBaseURL,
  findPlatformBlocker,
  findPlatformRow,
  findPlatformSendBlocker,
  isPlatformReady,
  isPlatformTarget,
  PLATFORM_PROVIDER_ID,
  PLATFORM_PROVIDER_NAME,
  toPlatformModels
}
