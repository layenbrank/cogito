/**
 * 密钥真源：OS Keyring（Rust IPC）。内存 cache 供同步读 JWT。
 * 非 Tauri 环境只走内存。
 */
import { emit, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

const AUTH_CHANGED = 'auth:changed'
const SECRET_SERVICE = 'cogito'

type SecretAccount = 'jwt' | `provider:${string}`

let jwtCache: string | null = null
let secretsReady = false

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

async function ensureSecrets(): Promise<void> {
  if (secretsReady) return
  if (!isTauriRuntime()) {
    secretsReady = true
    return
  }
  try {
    jwtCache = await invoke<string | null>(CHANNELS.SECRET.GET, {
      service: SECRET_SERVICE,
      account: 'jwt'
    })
  } catch (error) {
    console.warn('[secrets] hydrate jwt failed', error)
    jwtCache = null
  }
  secretsReady = true
}

function findJwtCache(): string | null {
  return jwtCache
}

/**
 * 写入 / 清空 JWT。
 *
 * **一律持久化**：服务端签发的 JWT 本身就是 24h 有效期，客户端把「要不要记住」
 * 变成一次性会话只会让用户一刷新就掉线。所以令牌始终落 OS Keyring，
 * 登录页的勾选项只管「记不记得用户名」。
 * 传 `null` 表示登出 / 令牌失效，Keyring 里那份必须一起删掉。
 */
async function writeJwtSecret(token: string | null): Promise<void> {
  jwtCache = token
  if (!isTauriRuntime()) return
  try {
    if (token) {
      await invoke(CHANNELS.SECRET.SET, {
        service: SECRET_SERVICE,
        account: 'jwt',
        secret: token
      })
    } else {
      await invoke(CHANNELS.SECRET.DELETE, {
        service: SECRET_SERVICE,
        account: 'jwt'
      })
    }
  } catch (error) {
    // 写失败不拦登录：本次会话仍可用，下次启动再重试
    console.warn('[secrets] persist jwt failed', error)
  }
  // 侧车桥接：会话期内写 goose 可读的 jwt 文件（Rust 内部）
  try {
    if (token) {
      await invoke(CHANNELS.COGITO.TOKEN_WRITE, { token })
    } else {
      await invoke(CHANNELS.COGITO.TOKEN_CLEAR)
    }
  } catch (error) {
    console.warn('[secrets] cogito jwt bridge failed', error)
  }
  // 跨窗：同一枚令牌要在每个窗口的内存里都生效
  void emit(AUTH_CHANGED, { token })
}

async function findProviderSecret(providerID: string): Promise<string | null> {
  if (!isTauriRuntime()) return null
  try {
    return await invoke<string | null>(CHANNELS.SECRET.GET, {
      service: SECRET_SERVICE,
      account: `provider:${providerID}`
    })
  } catch (error) {
    console.warn('[secrets] get provider key failed', error)
    return null
  }
}

async function writeProviderSecret(providerID: string, apiKey: string | null): Promise<void> {
  if (!isTauriRuntime()) return
  const account: SecretAccount = `provider:${providerID}`
  try {
    if (apiKey) {
      await invoke(CHANNELS.SECRET.SET, {
        service: SECRET_SERVICE,
        account,
        secret: apiKey
      })
      return
    }
    await invoke(CHANNELS.SECRET.DELETE, {
      service: SECRET_SERVICE,
      account
    })
  } catch (error) {
    console.warn('[secrets] write provider key failed', error)
  }
}

function subscribeAuthChanged(onChange: () => void): () => void {
  if (!isTauriRuntime()) {
    return function () {}
  }
  let unlisten: (() => void) | undefined
  void listen<{ token: string | null }>(AUTH_CHANGED, function (event) {
    jwtCache = event.payload?.token ?? null
    onChange()
  }).then(function (stop) {
    unlisten = stop
  })
  return function () {
    unlisten?.()
  }
}

export {
  AUTH_CHANGED,
  SECRET_SERVICE,
  ensureSecrets,
  findJwtCache,
  writeJwtSecret,
  findProviderSecret,
  writeProviderSecret,
  subscribeAuthChanged
}
export type { SecretAccount }
