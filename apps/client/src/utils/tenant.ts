import { findAuthToken } from '@/utils/auth'

/**
 * 「当前生效租户」的值缓存。
 *
 * 网关按请求头 `X-Tenant-ID` 决定配额归属与可见模型，而解析租户要打接口
 * （见 `features/quota/tenant.ts`）；这里只放**值**，好让 `utils/http/http.ts` 能同步读出来。
 *
 * 为什么不直接放解析那一侧：那边要 import `apis/tenant.ts`，而 `apis/*` 又依赖 `http.ts`
 * —— 反过来引会成环。
 *
 * 缓存一律带「解析时的登录令牌」指纹：换账号、退登之后立刻失效，宁可不带租户头
 * （服务端按账号归属兜底），也不能把配额记到上一个账号的租户上。
 */

let cachedID: string | null = null
let cachedToken: string | null = null
let cachedAt = 0

/** 同步读当前租户 id；令牌与写入时不一致一律当作「还没解析」 */
function findActiveTenantID(): string | null {
  if (cachedToken === null || cachedToken !== findAuthToken()) return null
  return cachedID
}

/** 已经解析过（含「确实没有个人租户」这个结论）且在有效期内，可以跳过再次解析 */
function isActiveTenantFresh(ttlMs: number): boolean {
  if (cachedToken === null || cachedToken !== findAuthToken()) return false
  return Date.now() - cachedAt < ttlMs
}

/**
 * 写入解析结果；`token` 是**发起解析时**的登录令牌 —— 结果只能记在发起它的账号名下。
 *
 * 令牌必须由调用方传进来，不能在这里现读：解析是异步的，等结果回来时账号可能已经换了，
 * 现读就会把上一个账号的租户盖上当前令牌的指纹，`findActiveTenantID` 于是把它当成
 * 「当前账号的租户」用满整个 TTL —— 配额就会记到别人头上。
 */
function cacheActiveTenant(id: string | null, token: string | null): void {
  cachedID = id
  cachedToken = token
  cachedAt = Date.now()
}

function clearActiveTenantCache(): void {
  cachedID = null
  cachedToken = null
  cachedAt = 0
}

export { cacheActiveTenant, clearActiveTenantCache, findActiveTenantID, isActiveTenantFresh }
