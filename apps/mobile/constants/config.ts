import Constants from 'expo-constants'
import { Platform } from 'react-native'

interface AppExtra {
  apiBaseUrl?: string
  defaultModel?: string
  tenantId?: string
}

/**
 * Reads Expo `extra` config merged with `EXPO_PUBLIC_*` env vars.
 */
function findAppExtra(): AppExtra {
  return (Constants.expoConfig?.extra ?? {}) as AppExtra
}

/**
 * Default rust-service base URL for local development.
 * Android emulator reaches host loopback via 10.0.2.2.
 */
function findDevApiBaseUrl() {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000'
  }
  return 'http://127.0.0.1:3000'
}

/**
 * Base URL for rust-service. Always prefers env / extra; falls back to local service.
 */
function findApiBaseUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim()
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '')
  }
  const fromExtra = findAppExtra().apiBaseUrl?.trim()
  if (fromExtra) {
    return fromExtra.replace(/\/$/, '')
  }
  return findDevApiBaseUrl()
}

function findDefaultModel() {
  return (
    process.env.EXPO_PUBLIC_DEFAULT_MODEL?.trim() ||
    findAppExtra().defaultModel?.trim() ||
    'gpt-4o-mini'
  )
}

function findTenantId() {
  return process.env.EXPO_PUBLIC_TENANT_ID?.trim() || findAppExtra().tenantId?.trim() || null
}

export { findApiBaseUrl, findDefaultModel, findTenantId }
