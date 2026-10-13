/**
 * Goose 扩展 ACP：全局配置（`config/extensions/*`）+ 会话内启停（`session/extensions/*`）。
 *
 * 全局配置落进 goose 的 config（`<GOOSE_PATH_ROOT>/config`），**对新会话生效**；已开会话的
 * 扩展集合由 `session/extensions/*` 单独维护。`session/extensions/add` 只接受**已存好的密钥**
 * （内联 env 值会被 goose 拒掉），所以加进会话时要把 `config/extensions/list` 的条目**原样**
 * 回传，别重建对象。
 */
import type { ClientConnection } from '@agentclientprotocol/sdk'

import type {
  ExtensionEntry,
  GooseExtension,
  SessionExtensionEntry
} from '@/features/agent/model/extension'

const GOOSE_CONFIG_EXTENSIONS_LIST = '_goose/unstable/config/extensions/list'
const GOOSE_CONFIG_EXTENSIONS_ADD = '_goose/unstable/config/extensions/add'
const GOOSE_CONFIG_EXTENSIONS_REMOVE = '_goose/unstable/config/extensions/remove'
const GOOSE_CONFIG_EXTENSIONS_SET_ENABLED = '_goose/unstable/config/extensions/set-enabled'
const GOOSE_SESSION_EXTENSIONS_LIST = '_goose/unstable/session/extensions/list'
const GOOSE_SESSION_EXTENSIONS_ADD = '_goose/unstable/session/extensions/add'
const GOOSE_SESSION_EXTENSIONS_REMOVE = '_goose/unstable/session/extensions/remove'

interface ConfigExtensionsSnapshot {
  extensions: ExtensionEntry[]
  warnings: string[]
}

/** 全局扩展配置 + goose 的解析告警（损坏的配置不会被静默丢掉） */
async function fetchConfigExtensions(
  connection: ClientConnection
): Promise<ConfigExtensionsSnapshot> {
  const response = await connection.agent.request<{
    extensions?: ExtensionEntry[]
    warnings?: string[]
  }>(GOOSE_CONFIG_EXTENSIONS_LIST, {})
  return { extensions: response.extensions ?? [], warnings: response.warnings ?? [] }
}

async function addConfigExtension(
  connection: ClientConnection,
  extension: GooseExtension,
  enabled = true
): Promise<void> {
  await connection.agent.request(GOOSE_CONFIG_EXTENSIONS_ADD, { extension, enabled })
}

async function removeConfigExtension(
  connection: ClientConnection,
  configKey: string
): Promise<void> {
  await connection.agent.request(GOOSE_CONFIG_EXTENSIONS_REMOVE, { configKey })
}

async function setConfigExtensionEnabled(
  connection: ClientConnection,
  configKey: string,
  enabled: boolean
): Promise<void> {
  await connection.agent.request(GOOSE_CONFIG_EXTENSIONS_SET_ENABLED, { configKey, enabled })
}

/** 某会话已启用的扩展（需要 goose session 上下文） */
async function fetchSessionExtensions(
  connection: ClientConnection,
  sessionId: string
): Promise<SessionExtensionEntry[]> {
  const response = await connection.agent.request<{ extensions?: SessionExtensionEntry[] }>(
    GOOSE_SESSION_EXTENSIONS_LIST,
    { sessionId }
  )
  return response.extensions ?? []
}

async function addSessionExtension(
  connection: ClientConnection,
  sessionId: string,
  extension: GooseExtension
): Promise<void> {
  await connection.agent.request(GOOSE_SESSION_EXTENSIONS_ADD, { sessionId, extension })
}

async function removeSessionExtension(
  connection: ClientConnection,
  sessionId: string,
  extensionKey: string
): Promise<void> {
  await connection.agent.request(GOOSE_SESSION_EXTENSIONS_REMOVE, { sessionId, extensionKey })
}

export type { ConfigExtensionsSnapshot }
export {
  addConfigExtension,
  addSessionExtension,
  fetchConfigExtensions,
  fetchSessionExtensions,
  removeConfigExtension,
  removeSessionExtension,
  setConfigExtensionEnabled
}
