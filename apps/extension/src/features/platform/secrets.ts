/**
 * 凭据（云端 JWT / 各 provider 的 apiKey）。
 *
 * **浏览器没有 keyring**：`chrome.storage.local` 是明文落盘的，与 `client` 的 OS Keyring
 * 不是一回事。这个差距不能靠「加个混淆」弥补，只能如实告诉用户：
 * - 默认不记住登录（token 放 `chrome.storage.session`，关浏览器就没）；
 * - 用户显式勾「记住」才写 `chrome.storage.local`；
 * - 设置页必须写明「扩展的令牌是明文存储的」。
 *
 * 本机 agent 代理的令牌**不在这里**：那是 127.0.0.1 的访问凭据，不是云端身份，
 * 放在 `prefs.agent.bridgeToken` 里，跟着偏好一起走。
 */

import { STORAGE_KEYS, findValue, writeValue } from './storage.ts'

interface SecretBag {
  /** 云端身份（网关 / 配额 / 模型目录都用它） */
  authToken: string | null
  /** provider id → apiKey */
  providerKeys: Record<string, string>
}

const SECRETS: SecretBag = { authToken: null, providerKeys: {} }

let cache: SecretBag = SECRETS
let isReady = false

function parseSecrets(value: unknown): SecretBag {
  if (!value || typeof value !== 'object') return SECRETS
  const bag = value as Partial<SecretBag>
  return {
    authToken: typeof bag.authToken === 'string' && bag.authToken ? bag.authToken : null,
    providerKeys: parseProviderKeys(bag.providerKeys)
  }
}

/** 逐项过一道类型：手改过的库不该让下游拿到非字符串的 key */
function parseProviderKeys(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [id, key] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key) out[id] = key
  }
  return out
}

async function ensureSecrets(): Promise<void> {
  if (isReady) return
  cache = parseSecrets(await findValue<SecretBag>(STORAGE_KEYS.secrets))
  isReady = true
}

function findAuthToken(): string | null {
  return cache.authToken
}

async function writeAuthToken(token: string | null): Promise<void> {
  cache = { ...cache, authToken: token && token.trim() ? token.trim() : null }
  await writeValue(STORAGE_KEYS.secrets, cache)
}

function findProviderKey(providerID: string): string | null {
  return cache.providerKeys[providerID] ?? null
}

async function writeProviderKey(providerID: string, key: string | null): Promise<void> {
  const next = { ...cache.providerKeys }
  if (key && key.trim()) next[providerID] = key.trim()
  else delete next[providerID]
  cache = { ...cache, providerKeys: next }
  await writeValue(STORAGE_KEYS.secrets, cache)
}

export {
  SECRETS,
  ensureSecrets,
  findAuthToken,
  findProviderKey,
  parseProviderKeys,
  parseSecrets,
  writeAuthToken,
  writeProviderKey
}
export type { SecretBag }
