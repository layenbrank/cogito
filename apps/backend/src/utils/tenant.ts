import { findAuthToken } from '@/utils/auth'

let cachedID: string | null = null
let cachedToken: string | null = null
let cachedAt = 0

function findActiveTenantID(): string | null {
  if (cachedToken === null || cachedToken !== findAuthToken()) return null
  return cachedID
}

function isActiveTenantFresh(ttlMs: number): boolean {
  if (cachedToken === null || cachedToken !== findAuthToken()) return false
  return Date.now() - cachedAt < ttlMs
}

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
