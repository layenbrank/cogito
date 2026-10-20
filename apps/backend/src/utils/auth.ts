import { HttpError } from '@/utils/http/errors.ts'

const AUTH_TOKEN_KEY = 'auth-token'
const AUTH_REMEMBER_USERNAME_KEY = 'auth-remember-username'
const ADMIN_ROLE = 'ADMIN'
const SESSION_INVALID_CODES: readonly number[] = [300_001, 300_002, 300_003]

interface AuthClaims {
  sub?: string
  username?: string
  role?: string
  exp?: number
}

type AuthTokenListener = () => void

const authTokenListeners = new Set<AuthTokenListener>()

function findAuthStores(): Storage[] {
  const stores: Storage[] = []
  if (typeof localStorage !== 'undefined') stores.push(localStorage)
  if (typeof sessionStorage !== 'undefined') stores.push(sessionStorage)
  return stores
}

function notifyAuthToken(): void {
  for (const listener of [...authTokenListeners]) listener()
}

function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== AUTH_TOKEN_KEY) return
  notifyAuthToken()
}

let isCrossWindowListening = false

function listenCrossWindow(): void {
  if (isCrossWindowListening || typeof window === 'undefined') return
  window.addEventListener('storage', handleStorageEvent)
  isCrossWindowListening = true
}

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
    if (isAuthTokenExpired(token)) {
      sawExpired = true
      continue
    }
    return token
  }
  if (sawExpired) {
    for (const store of findAuthStores()) store.removeItem(AUTH_TOKEN_KEY)
  }
  return null
}

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
  } catch {
    return null
  }
}

function parseAuthRole(token: string | null | undefined): string | null {
  const role = parseAuthClaims(token)?.role
  return typeof role === 'string' ? role : null
}

function parseAuthExpiry(token: string | null | undefined): number | null {
  const exp = parseAuthClaims(token)?.exp
  return typeof exp === 'number' ? exp * 1000 : null
}

function isAuthTokenExpired(token: string | null | undefined): boolean {
  const expiry = parseAuthExpiry(token)
  return expiry !== null && expiry <= Date.now()
}

function findAuthRole(): string | null {
  return parseAuthRole(findAuthToken())
}

function isAdmin(): boolean {
  return findAuthRole() === ADMIN_ROLE
}

function writeAuthToken(token: string, isRemembered: boolean): void {
  const keep = isRemembered ? localStorage : sessionStorage
  const drop = isRemembered ? sessionStorage : localStorage
  drop.removeItem(AUTH_TOKEN_KEY)
  keep.setItem(AUTH_TOKEN_KEY, token)
  notifyAuthToken()
}

function findRememberedUsername(): string | null {
  if (typeof localStorage === 'undefined') return null
  const username = localStorage.getItem(AUTH_REMEMBER_USERNAME_KEY)
  return username && username.trim() ? username : null
}

function writeRememberedUsername(username: string | null): void {
  if (typeof localStorage === 'undefined') return
  if (!username || !username.trim()) {
    localStorage.removeItem(AUTH_REMEMBER_USERNAME_KEY)
    return
  }
  localStorage.setItem(AUTH_REMEMBER_USERNAME_KEY, username.trim())
}

function clearAuthToken(): void {
  for (const store of findAuthStores()) store.removeItem(AUTH_TOKEN_KEY)
  notifyAuthToken()
}

function clearAuthTokenIfCurrent(token: string | null): boolean {
  if (!token || findAuthToken() !== token) return false
  clearAuthToken()
  return true
}

function isAuthenticated(): boolean {
  return Boolean(findAuthToken())
}

function isSessionInvalid(error: unknown): boolean {
  return SESSION_INVALID_CODES.includes(HttpError(error).code)
}

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
