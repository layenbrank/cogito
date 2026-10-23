import {
  ensureSecrets,
  findJwtCache,
  findPref,
  patchPref,
  subscribeAuthChanged,
  writeJwtSecret
} from '@/features/persist'
import { HttpError } from '@/utils/http/errors.ts'

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
 * 令牌读写：内存 cache 同步读；「记住我」落 OS Keyring；侧车 jwt 仅 Rust 桥接。
 * 跨窗经 Tauri `auth:changed`，不再用 Web Storage / storage 事件。
 */
const authTokenListeners = new Set<AuthTokenListener>()

function notifyAuthToken(): void {
  for (const listener of [...authTokenListeners]) listener()
}

let stopCrossWindow: (() => void) | null = null

function listenCrossWindow(): void {
  if (stopCrossWindow) return
  stopCrossWindow = subscribeAuthChanged(function () {
    notifyAuthToken()
  })
}

function unlistenCrossWindow(): void {
  if (!stopCrossWindow || authTokenListeners.size > 0) return
  stopCrossWindow()
  stopCrossWindow = null
}

function findAuthToken(): string | null {
  const token = findJwtCache()
  if (!token) return null
  // 过期令牌不是登录态：留着它只会让每个接口回一句「登录已过期」
  if (isAuthTokenExpired(token)) {
    void writeJwtSecret(null, false).then(function () {
      notifyAuthToken()
    })
    return null
  }
  return token
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

/** 记住我进 Keyring，否则只留内存到本次会话；侧车桥接由 secrets 统一处理 */
function writeAuthToken(token: string, isRemembered: boolean): void {
  void writeJwtSecret(token, isRemembered).then(function () {
    notifyAuthToken()
  })
  // 同步通知：jwtCache 已在 writeJwtSecret 开头写入
  notifyAuthToken()
}

/** 读出上次「记住我」留下的用户名；没有 / 不可用时返回 null */
function findRememberedUsername(): string | null {
  const username = findPref('window').rememberedUsername
  return username && username.trim() ? username : null
}

/**
 * 写入或清掉记住的用户名。
 *
 * 勾选「记住我」登录成功后写入；未勾选 / 主动忘掉时传 `null` 清掉。
 * 退出登录**不清**这一项 —— 否则「记住我」在登出后再打开登录框就等于没记住。
 */
function writeRememberedUsername(username: string | null): void {
  const next = username && username.trim() ? username.trim() : null
  void patchPref('window', { rememberedUsername: next })
}

/** 退出登录、或令牌被判失效时用：清 Keyring + 内存 + 侧车桥接。不碰「记住的用户名」。 */
function clearAuthToken(): void {
  void writeJwtSecret(null, false).then(function () {
    notifyAuthToken()
  })
  notifyAuthToken()
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

/** 令牌变化的订阅入口（React 侧经 `useAuthToken` 使用）；同时接上跨窗口的 `auth:changed` */
function subscribeAuthToken(listener: AuthTokenListener): () => void {
  authTokenListeners.add(listener)
  listenCrossWindow()
  void ensureSecrets()

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
