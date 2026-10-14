import { syncCogitoJwt } from '@/utils/cogito-token.ts'
import { HttpError } from '@/utils/http/errors.ts'

const AUTH_TOKEN_KEY = 'auth-token'
/** 「记住我」勾选登录时留下的用户名；退出登录后回填表单，不存密码 */
const AUTH_REMEMBER_USERNAME_KEY = 'auth-remember-username'

/** 与 service 的 `role()` 对齐：只有精确 ADMIN 才算管理员 */
const ADMIN_ROLE = 'ADMIN'

/**
 * service 的错误码（`src/utils/code.rs` 的 auth 段）：300001 未登录、300002 凭证无效
 * （含「令牌已进黑名单」—— 登出后/被顶下线的令牌实测就是这个码）、300003 令牌过期。
 */
const SESSION_INVALID_CODES: readonly number[] = [300_001, 300_002, 300_003]

/** JWT 里够用的声明；身份展示只用 `username` / `role`，鉴权一律由服务端判定 */
interface AuthClaims {
  sub?: string
  username?: string
  role?: string
  /** 过期时刻（秒，JWT 标准声明） */
  exp?: number
}

type AuthTokenListener = () => void

/**
 * 令牌读写是同步的，但界面得跟着刷 —— 登录/登出不该要求用户重开窗口。
 * 每次写入都通知订阅者，`useAuthToken` 就挂在这上面。
 */
const authTokenListeners = new Set<AuthTokenListener>()

/** 「记住我」进 localStorage，否则只留到这次会话结束；两处都可能存着旧令牌，一律按这两个存储处理 */
function findAuthStores(): Storage[] {
  const stores: Storage[] = []
  if (typeof localStorage !== 'undefined') stores.push(localStorage)
  if (typeof sessionStorage !== 'undefined') stores.push(sessionStorage)
  return stores
}

function notifyAuthToken(): void {
  for (const listener of [...authTokenListeners]) listener()
}

/**
 * 跨窗口同步：Electron 每个窗口一个渲染进程，`storage` 事件是它们之间唯一的信号。
 *
 * 只听本窗口的订阅者，会让「主窗口登录成功、agent 窗口的左栏还挂着未登录的假头像」——
 * 令牌本来就在同一份 localStorage 里（所有窗口共用默认 session），差的只是没人让它重读。
 * 按规范事件只发给**其它**文档，本窗口的写入由 `notifyAuthToken` 自己广播，不会重复通知。
 */
function handleStorageEvent(event: StorageEvent): void {
  // 整份存储被清掉时 `key` 是 null，令牌也可能跟着没了，一样要重读
  if (event.key !== null && event.key !== AUTH_TOKEN_KEY) return
  notifyAuthToken()
}

let isCrossWindowListening = false

function listenCrossWindow(): void {
  if (isCrossWindowListening || typeof window === 'undefined') return

  window.addEventListener('storage', handleStorageEvent)
  isCrossWindowListening = true
}

/** 没有订阅者了就别再挂着监听（热更与测试里反复订阅不该越积越多） */
function unlistenCrossWindow(): void {
  if (!isCrossWindowListening || authTokenListeners.size > 0) return

  window.removeEventListener('storage', handleStorageEvent)
  isCrossWindowListening = false
}

function findAuthToken(): string | null {
  let sawExpired = false
  for (const store of findAuthStores()) {
    const token = store.getItem(AUTH_TOKEN_KEY)
    if (!token) continue
    // 过期令牌不是登录态：留着它只会让每个接口回一句「登录已过期」，
    // 界面却一直显示「已登录」—— 用户看到的就是「明明登录着，却总说登录过期」
    if (isAuthTokenExpired(token)) {
      sawExpired = true
      continue
    }
    return token
  }
  // 内存已视为未登录时，同步清掉磁盘 JWT，避免 goose auth.command 继续带废票
  if (sawExpired) {
    for (const store of findAuthStores()) store.removeItem(AUTH_TOKEN_KEY)
    syncCogitoJwt(null)
  }
  return null
}

/** 取 JWT payload；令牌缺失/不是 JWT/解不开都返回 null（脏令牌不能变成身份） */
function parseAuthClaims(token: string | null | undefined): AuthClaims | null {
  if (!token) return null
  const segment = token.split('.')[1]
  if (!segment) return null

  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, function (char) {
      return char.charCodeAt(0)
    })
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (typeof claims !== 'object' || claims === null) return null
    return claims
  } catch (error) {
    console.warn('登录令牌的 payload 解不开，按「没有身份」处理', error)
    return null
  }
}

/** 取 JWT payload 里的平台角色 */
function parseAuthRole(token: string | null | undefined): string | null {
  const role = parseAuthClaims(token)?.role
  return typeof role === 'string' ? role : null
}

/** JWT 的过期时刻（ms）；没有 `exp` / 不是数字 / 解不开都返回 null（判不了就不判） */
function parseAuthExpiry(token: string | null | undefined): number | null {
  const exp = parseAuthClaims(token)?.exp
  return typeof exp === 'number' ? exp * 1000 : null
}

/**
 * 本地就能判定的过期：`exp` 已过就是一张废令牌。
 *
 * 判不了（缺 `exp`、脏令牌）时按**未过期**处理：宁可让服务端去否，也不要凭猜测把人登出。
 */
function isAuthTokenExpired(token: string | null | undefined): boolean {
  const expiry = parseAuthExpiry(token)
  return expiry !== null && expiry <= Date.now()
}

function findAuthRole(): string | null {
  return parseAuthRole(findAuthToken())
}

/** 网关管理面（供应商/模型/用量/审计）只对管理员开放 */
function isAdmin(): boolean {
  return findAuthRole() === ADMIN_ROLE
}

/** 记住我进 localStorage，否则只留到这次会话结束 */
function writeAuthToken(token: string, isRemembered: boolean): void {
  const keep = isRemembered ? localStorage : sessionStorage
  const drop = isRemembered ? sessionStorage : localStorage
  drop.removeItem(AUTH_TOKEN_KEY)
  keep.setItem(AUTH_TOKEN_KEY, token)
  notifyAuthToken()
  // 同步到 goose 侧车读得到的 JWT 文件（auth.command 用它调网关）
  syncCogitoJwt(token)
}

/** 读出上次「记住我」留下的用户名；没有 / 不可用时返回 null */
function findRememberedUsername(): string | null {
  if (typeof localStorage === 'undefined') return null
  const username = localStorage.getItem(AUTH_REMEMBER_USERNAME_KEY)
  return username && username.trim() ? username : null
}

/**
 * 写入或清掉记住的用户名。
 *
 * 勾选「记住我」登录成功后写入；未勾选 / 主动忘掉时传 `null` 清掉。
 * 退出登录**不清**这一项 —— 否则「记住我」在登出后再打开登录框就等于没记住。
 */
function writeRememberedUsername(username: string | null): void {
  if (typeof localStorage === 'undefined') return
  if (!username || !username.trim()) {
    localStorage.removeItem(AUTH_REMEMBER_USERNAME_KEY)
    return
  }
  localStorage.setItem(AUTH_REMEMBER_USERNAME_KEY, username.trim())
}

/** 退出登录、或令牌被判失效时用：两处存储都清掉，界面立刻回到未登录。不碰「记住的用户名」。 */
function clearAuthToken(): void {
  for (const store of findAuthStores()) store.removeItem(AUTH_TOKEN_KEY)
  notifyAuthToken()
  syncCogitoJwt(null)
}

/**
 * 只在「当前这一枚还是它」时清掉。
 *
 * 用处：手里握着一枚旧令牌的响应回来判失效时，界面可能已经换成新的一枚（用户刚重新登录），
 * 无脑清就等于把刚登录的人踢下线 —— 症状是「明明登录成功了，发消息却报登录已过期」。
 * 返回是否真的清了（调用方据此决定要不要提示）。
 */
function clearAuthTokenIfCurrent(token: string | null): boolean {
  if (!token || findAuthToken() !== token) return false
  clearAuthToken()
  return true
}

function isAuthenticated(): boolean {
  return Boolean(findAuthToken())
}

/**
 * 令牌是否已失效（未登录 / 已过期 / 已被服务端登出）。
 *
 * 只有这几种才该丢掉本地令牌：服务端不通、权限不足（300006/300007）都不算「没登录」，
 * 清掉令牌等于把用户无故登出。
 */
function isSessionInvalid(error: unknown): boolean {
  return SESSION_INVALID_CODES.includes(HttpError(error).code)
}

/** 令牌变化的订阅入口（React 侧经 `useAuthToken` 使用）；同时接上跨窗口的 `storage` 事件 */
function subscribeAuthToken(listener: AuthTokenListener): () => void {
  authTokenListeners.add(listener)
  listenCrossWindow()

  return function () {
    authTokenListeners.delete(listener)
    unlistenCrossWindow()
  }
}

export {
  ADMIN_ROLE,
  clearAuthToken,
  clearAuthTokenIfCurrent,
  findAuthRole,
  findAuthToken,
  findRememberedUsername,
  isAdmin,
  isAuthenticated,
  isAuthTokenExpired,
  isSessionInvalid,
  parseAuthClaims,
  parseAuthExpiry,
  parseAuthRole,
  subscribeAuthToken,
  writeAuthToken,
  writeRememberedUsername
}
export type { AuthClaims }
