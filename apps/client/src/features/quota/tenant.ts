import { GET_MY_TENANTS, PERSONAL_TENANT, type Tenant } from '@/apis/tenant.ts'
import { findAuthToken, subscribeAuthToken } from '@/utils/auth.ts'
import {
  cacheActiveTenant,
  clearActiveTenantCache,
  findActiveTenantID,
  isActiveTenantFresh
} from '@/utils/tenant.ts'

/**
 * 「这次请求算到哪个租户头上」的解析入口。
 *
 * 网关按请求头 `X-Tenant-ID` 决定配额归属，而**只有个人租户**能命中订阅档位/免费档
 * （团队租户与不带租户身份都回落全局配额）。
 *
 * 为什么缓存而不是每次现查：租户 id 要写进 goose 的自定义 provider `headers`，而 goose 那份配置
 * 是**异步**落盘的，发起时不该再等一次网络；值缓存在 `utils/tenant.ts`（`http.ts` 也要同步读它），
 * 这里负责「怎么解析、什么时候作废」。
 *
 * 个人租户由注册 / 管理建号 / SSO 新建在服务端开通；客户端只解析，不再补建。
 */

/** 缓存有效期：租户归属很少变，但换账号必须能立刻反映（`utils/tenant.ts` 用令牌指纹兜底） */
const CACHE_TTL_MS = 5 * 60_000

/**
 * 在途解析。带上**发起时**的令牌与代数：换账号后不能复用上一账号那一份
 * （它 resolve 成 null，这一次就不带租户头，用量被算到全局配额上）；
 * 代数用来认领槽位 —— 上一代结束时不能把已经接任的新一代抹掉。
 */
interface PendingTenant {
  token: string | null
  generation: number
  promise: Promise<string | null>
}

let pending: PendingTenant | null = null
let pendingGeneration = 0

/** 个人租户优先：免费档与订阅档位都挂在它上面 */
function findPersonalTenant(tenants: Tenant[]): Tenant | null {
  return (
    tenants.find(function (tenant) {
      return String(tenant.type ?? '').toUpperCase() === PERSONAL_TENANT
    }) ?? null
  )
}

/** 无 PERSONAL 时的兜底：任意已归属租户仍可带 X-Tenant-ID（配额按服务端规则回落） */
function findFallbackTenant(tenants: Tenant[]): Tenant | null {
  return tenants[0] ?? null
}

function clearActiveTenant(): void {
  clearActiveTenantCache()
}

/**
 * 解析并缓存当前租户 id；解析不出来返回 null。
 *
 * 失败时清掉缓存而不是沿用旧值：宁可不带租户头（服务端按用户归属兜底），也不要拿旧
 * 账号的租户去算配额。解析失败只留痕，不抛错 —— 网关不通不该把发消息挡住（组织模型注册另议）。
 *
 * 解析期间换了账号/退登：这份结果属于上一个账号，直接丢弃（本次不带租户头），也不写缓存，
 * 下次调用为新账号重新解析。
 */
async function syncActiveTenant(options: { force?: boolean } = {}): Promise<string | null> {
  if (!options.force && isActiveTenantFresh(CACHE_TTL_MS)) return findActiveTenantID()

  // 解析期间用户可能已经换账号/退登：结果只认**发起时**的令牌。
  // 认错的话，A 的租户 id 会被缓存到 B 的名下（TTL 内一直生效），B 的用量就记到 A 头上了。
  const token = findAuthToken()
  if (!token) {
    clearActiveTenant()
    return null
  }

  // 复用只限同一个账号的在途请求
  if (pending && pending.token === token) return pending.promise

  pendingGeneration += 1
  const generation = pendingGeneration

  const promise = (async function () {
    try {
      const tenants = await GET_MY_TENANTS()
      // 令牌换人了：这份结果属于上一个账号，丢掉（本次不带租户头，服务端按账号归属兜底）
      if (token !== findAuthToken()) return null

      const personal = findPersonalTenant(tenants) ?? findFallbackTenant(tenants)
      if (token !== findAuthToken()) return null

      cacheActiveTenant(personal ? personal.id : null, token)
      return findActiveTenantID()
    } catch (error) {
      clearActiveTenant()
      console.warn('[quota] 租户解析失败，这次不带租户身份', error)
      return null
    } finally {
      // 只清自己那一代：换账号后新一轮解析可能已经占了槽，别把它抹掉
      if (pending?.generation === generation) pending = null
    }
  })()

  pending = { token, generation, promise }
  return promise
}

/**
 * 跟随令牌变化重新解析：登录、切账号、退登都走这一条。
 * 令牌没了就只清缓存（未登录时的请求本来也不该带租户头）。
 */
function watchActiveTenant(): () => void {
  return subscribeAuthToken(function () {
    if (findAuthToken() === null) {
      clearActiveTenant()
      return
    }
    void syncActiveTenant({ force: true })
  })
}

export {
  CACHE_TTL_MS,
  clearActiveTenant,
  findPersonalTenant,
  syncActiveTenant,
  watchActiveTenant
}
