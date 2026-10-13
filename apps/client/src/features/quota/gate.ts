/**
 * 发送前的配额拦截（平台网关）。
 *
 * 服务端本来就会拦（`QuotaExceeded` = 400006，HTTP 200 + 错误码），提前拦一次的唯一收益是
 * **用户点下发送就能看到原因**，不用等一次半截的运行失败。所以判定原则是「算不准就放行」：
 * 接口不通、解析失败 —— 一律交给服务端。
 *
 * 判定数字直接取 `GET /gateway/quota/me?model=<目录名>`：服务端按身份归属 + 模型覆盖 + 档位
 * 一处算好，还带上了「此刻是否已触顶」，客户端不需要（也不该）自己拼这套判定。
 *
 * 只拦平台网关：BYOK 的 provider 直接打上游，不经服务端配额。
 */
import { GET_GATEWAY_QUOTA_ME, type GatewaySelfQuota } from '@/apis/gateway.ts'

import { syncActiveTenant } from './tenant.ts'

/** 平台网关在 goose 里的 providerId（与 Rust `cogito_provider::PROVIDER_ID` 一致） */
const GATEWAY_PROVIDER_KIND = 'cogito_gateway'

/** 判定结果缓存：发一条消息不该顺手打一个接口（订阅成功后由 `clearQuotaCheck()` 立即失效） */
const CHECK_TTL_MS = 60_000

interface SendTarget {
  isGateway: boolean
  /** 网关目录里的 `name`（也就是 provider 行里模型的 `id`） */
  modelID: string | null
}

let cached: { key: string; at: number; blocker: string | null } | null = null

/** 订阅/取消订阅后调用：档位变了，之前算出的结论作废 */
function clearQuotaCheck(): void {
  cached = null
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${Math.round(count / 1_000_000)}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`
  return String(count)
}

/**
 * 该不该拦下这次发送。
 *
 * 目前只认 `exhausted`（服务端的权威结论）。计划里「remaining <= reserve 软拦截」的 reserve
 * 还没定来源（要等订阅档位信息），先不设 —— 拦错比不拦更糟，软拦截要拦得对才能上线。
 */
function buildBlocker(quota: GatewaySelfQuota): string | null {
  if (!quota.exhausted) return null
  return `今日额度已用尽（${formatTokens(quota.used)} / ${formatTokens(quota.limit)} tokens，按 UTC 零点重置）。可在「设置 → 额度」订阅更高档位，或明天再试。`
}

/**
 * 放行时返回 null；任何一步失败都放行 —— 拦截是「提前告知」，不是「守门的」，守门的是服务端。
 */
async function findSendBlocker(target: SendTarget): Promise<string | null> {
  if (!target.isGateway) return null

  // 顺路把租户解析刷新掉，让 `http` 的 `X-Tenant-ID` 与聊天链路同一口径；
  // 解析不出来也不影响判定：服务端会按账号归属回答。
  const tenantID = await syncActiveTenant()
  const key = `${tenantID ?? ''}:${target.modelID ?? ''}`
  if (cached && cached.key === key && Date.now() - cached.at < CHECK_TTL_MS) return cached.blocker

  try {
    const quota = await GET_GATEWAY_QUOTA_ME(target.modelID ? { model: target.modelID } : {})
    const blocker = buildBlocker(quota)
    cached = { key, at: Date.now(), blocker }
    return blocker
  } catch (error) {
    // 失败也进缓存：网关不通不该每条消息都打一次空枪
    cached = { key, at: Date.now(), blocker: null }
    console.warn('[quota] 发送前配额检查失败，交给服务端判定', error)
    return null
  }
}

/** 当前发送目标是否走平台网关（goose providerId === `cogito_gateway`） */
function isGatewayTarget(providerKind: string | undefined): boolean {
  return providerKind === GATEWAY_PROVIDER_KIND
}

export { GATEWAY_PROVIDER_KIND, buildBlocker, clearQuotaCheck, findSendBlocker, isGatewayTarget }
export type { SendTarget }
