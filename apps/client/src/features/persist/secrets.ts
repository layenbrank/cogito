/**
 * 密钥真源：OS Keyring（Rust IPC）。内存 cache 供同步读 JWT。
 * 没有 IPC 能力时（嵌入壳 / 单测）只走内存。
 */
import { emit, listen } from '@tauri-apps/api/event'

import { DELETE_COGITO_TOKEN, POST_COGITO_TOKEN } from '@/apis/agent-runtime'
import { DELETE_SECRET, GET_SECRET, PUT_SECRET } from '@/apis/secret'
import { canUseTauriIpc } from '@/features/window/shell-mode'

const AUTH_CHANGED = 'auth:changed'
const SECRET_SERVICE = 'cogito'

type SecretAccount = 'jwt' | `provider:${string}`

let jwtCache: string | null = null
let secretsReady = false

async function ensureSecrets(): Promise<void> {
  if (secretsReady) return
  if (!canUseTauriIpc()) {
    secretsReady = true
    return
  }
  try {
    jwtCache = await GET_SECRET(SECRET_SERVICE, 'jwt')
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
  if (!canUseTauriIpc()) return
  try {
    if (token) {
      await PUT_SECRET(SECRET_SERVICE, 'jwt', token)
    } else {
      await DELETE_SECRET(SECRET_SERVICE, 'jwt')
    }
  } catch (error) {
    // 写失败不拦登录：本次会话仍可用，下次启动再重试
    console.warn('[secrets] persist jwt failed', error)
  }
  // 侧车桥接：会话期内写 goose 可读的 jwt 文件（Rust 内部）
  try {
    if (token) {
      await POST_COGITO_TOKEN(token)
    } else {
      await DELETE_COGITO_TOKEN()
    }
  } catch (error) {
    console.warn('[secrets] cogito jwt bridge failed', error)
  }
  // 跨窗：同一枚令牌要在每个窗口的内存里都生效
  void emit(AUTH_CHANGED, { token }).catch(function (error: unknown) {
    console.warn('[secrets] 广播 auth:changed 失败', error)
  })
}

async function GET_PROVIDER_SECRET(providerID: string): Promise<string | null> {
  if (!canUseTauriIpc()) return null
  try {
    return await GET_SECRET(SECRET_SERVICE, `provider:${providerID}`)
  } catch (error) {
    console.warn('[secrets] get provider key failed', error)
    return null
  }
}

async function PUT_PROVIDER_SECRET(providerID: string, apiKey: string | null): Promise<void> {
  if (!canUseTauriIpc()) return
  const account: SecretAccount = `provider:${providerID}`
  try {
    if (apiKey) {
      await PUT_SECRET(SECRET_SERVICE, account, apiKey)
      return
    }
    await DELETE_SECRET(SECRET_SERVICE, account)
  } catch (error) {
    console.warn('[secrets] write provider key failed', error)
  }
}

function subscribeAuthChanged(onChange: () => void): () => void {
  if (!canUseTauriIpc()) {
    return function () {}
  }
  let unlisten: (() => void) | undefined
  void listen<{ token: string | null }>(AUTH_CHANGED, function (event) {
    jwtCache = event.payload?.token ?? null
    onChange()
  })
    .then(function (stop) {
      unlisten = stop
    })
    .catch(function (error: unknown) {
      // 嵌套预览壳没有 IPC：订阅失败只该留一行日志，不能变成未处理的 rejection
      console.warn('[secrets] 订阅 auth:changed 失败', error)
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
  GET_PROVIDER_SECRET,
  PUT_PROVIDER_SECRET,
  subscribeAuthChanged
}
export type { SecretAccount }
