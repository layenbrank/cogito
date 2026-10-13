/**
 * Goose 扩展 ACP：providers inventory / config / defaults（对齐 Desktop providers.ts）
 * readiness/check 仅适用于 acp===true 的供应商。
 */
import type { ClientConnection } from '@agentclientprotocol/sdk'

const GOOSE_PROVIDERS_LIST = '_goose/unstable/providers/list'
const GOOSE_PROVIDERS_CONFIG_READ = '_goose/unstable/providers/config/read'
const GOOSE_PROVIDERS_CONFIG_SAVE = '_goose/unstable/providers/config/save'
const GOOSE_PROVIDERS_INVENTORY_REFRESH = '_goose/unstable/providers/inventory/refresh'
const GOOSE_PROVIDERS_READINESS_CHECK = '_goose/unstable/providers/readiness/check'
const GOOSE_DEFAULTS_READ = '_goose/unstable/defaults/read'
const GOOSE_DEFAULTS_SAVE = '_goose/unstable/defaults/save'
const GOOSE_CONFIG_READ = '_goose/unstable/config/read'
const GOOSE_CONFIG_UPSERT = '_goose/unstable/config/upsert'
const GOOSE_TOOLS_LIST = '_goose/unstable/tools/list'
const GOOSE_TOOLS_PERMISSIONS_SET = '_goose/unstable/tools/permissions/set'

const CONFIG_AUTO_COMPACT_THRESHOLD = 'GOOSE_AUTO_COMPACT_THRESHOLD'
const AUTO_COMPACT_THRESHOLD = 0.8

const INVENTORY_POLL_MS = 100
const INVENTORY_TIMEOUT_MS = 30_000

interface GooseConfigKey {
  name: string
  required: boolean
  secret: boolean
  default?: string | null
}

interface GooseConfigField {
  key: string
  value: string
}

interface GooseProviderEntry {
  providerId: string
  providerName: string
  description: string
  configured: boolean
  available: boolean
  visibleInSetup: boolean
  isAcp: boolean
  isRefreshing: boolean
  defaultModel: string | null
  configKeys: GooseConfigKey[]
  models: string[]
  setupSteps: string[]
}

interface GooseDefaults {
  providerId: string | null
  modelId: string | null
}

interface RawConfigKey {
  name?: string
  required?: boolean
  secret?: boolean
  default?: string | null
}

interface RawModel {
  id?: string
  name?: string
}

interface RawInventoryEntry {
  providerId?: string
  providerName?: string
  description?: string
  configured?: boolean
  available?: boolean
  visibleInSetup?: boolean
  acp?: boolean
  refreshing?: boolean
  defaultModel?: string | null
  configKeys?: RawConfigKey[]
  models?: RawModel[]
  setupSteps?: string[]
}

interface ProviderListResponse {
  entries?: RawInventoryEntry[]
}

interface ConfigReadResponse {
  fields?: GooseConfigField[]
}

interface ConfigSaveResponse {
  refresh?: {
    started?: string[]
    skipped?: Array<{ providerId?: string; reason?: string }>
  }
}

interface ReadinessResponse {
  ready?: boolean
  error?: string | null
}

interface DefaultsResponse {
  providerId?: string | null
  modelId?: string | null
}

interface ConfigValueResponse {
  value?: unknown
}

function parseConfigKeys(raw: RawConfigKey[] | undefined): GooseConfigKey[] {
  return (raw ?? [])
    .map(function (item) {
      const name = item.name?.trim()
      if (!name) return null
      return {
        name,
        required: item.required === true,
        secret: item.secret === true,
        default: item.default ?? null
      }
    })
    .filter(Boolean) as GooseConfigKey[]
}

function parseModels(raw: RawModel[] | undefined): string[] {
  return (raw ?? [])
    .map(function (model) {
      return model.id || model.name || ''
    })
    .filter(Boolean)
}

function parseProviderEntry(raw: RawInventoryEntry): GooseProviderEntry | null {
  const providerId = raw.providerId?.trim()
  if (!providerId) return null
  return {
    providerId,
    providerName: raw.providerName?.trim() || providerId,
    description: raw.description?.trim() || '',
    configured: raw.configured === true,
    available: raw.available !== false,
    visibleInSetup: raw.visibleInSetup === true,
    isAcp: raw.acp === true,
    isRefreshing: raw.refreshing === true,
    defaultModel: raw.defaultModel ?? null,
    configKeys: parseConfigKeys(raw.configKeys),
    models: parseModels(raw.models),
    setupSteps: Array.isArray(raw.setupSteps) ? raw.setupSteps.filter(Boolean) : []
  }
}

/** 按 inventory configKeys 从表单值生成 save fields（跳过空值） */
function parseConfigFields(
  configKeys: GooseConfigKey[],
  values: Record<string, string>
): GooseConfigField[] {
  const fields: GooseConfigField[] = []
  for (const key of configKeys) {
    const value = values[key.name]?.trim() ?? ''
    if (!value) continue
    fields.push({ key: key.name, value })
  }
  return fields
}

function findSetupProviders(entries: GooseProviderEntry[]): GooseProviderEntry[] {
  return entries.filter(function (entry) {
    return entry.visibleInSetup
  })
}

function findConfiguredProviders(entries: GooseProviderEntry[]): GooseProviderEntry[] {
  return entries.filter(function (entry) {
    return entry.configured
  })
}

/** 设置页：可配置或已配置（对齐 Desktop settings 列表） */
function findSettingsProviders(entries: GooseProviderEntry[]): GooseProviderEntry[] {
  return entries.filter(function (entry) {
    return entry.visibleInSetup || entry.configured
  })
}

async function fetchGooseProviders(
  connection: ClientConnection,
  providerIds?: string[]
): Promise<GooseProviderEntry[]> {
  const params = providerIds?.length ? { providerIds } : {}
  const response = await connection.agent.request<ProviderListResponse>(GOOSE_PROVIDERS_LIST, params)
  return (response.entries ?? [])
    .map(parseProviderEntry)
    .filter(Boolean) as GooseProviderEntry[]
}

async function fetchProviderEntry(
  connection: ClientConnection,
  providerId: string
): Promise<GooseProviderEntry | null> {
  const entries = await fetchGooseProviders(connection, [providerId])
  return (
    entries.find(function (entry) {
      return entry.providerId === providerId
    }) ?? null
  )
}

async function fetchProviderModels(
  connection: ClientConnection,
  providerId: string
): Promise<string[]> {
  const entry = await fetchProviderEntry(connection, providerId)
  return entry?.models ?? []
}

async function fetchProviderConfig(
  connection: ClientConnection,
  providerId: string
): Promise<GooseConfigField[]> {
  const response = await connection.agent.request<ConfigReadResponse>(GOOSE_PROVIDERS_CONFIG_READ, {
    providerId
  })
  return response.fields ?? []
}

async function waitInventoryIdle(
  connection: ClientConnection,
  providerId: string,
  refresh: ConfigSaveResponse['refresh'] | undefined
): Promise<GooseProviderEntry> {
  const started = refresh?.started?.includes(providerId) === true
  const alreadyRefreshing = refresh?.skipped?.some(function (item) {
    return item.providerId === providerId && item.reason === 'already_refreshing'
  })
  const attempts = started || alreadyRefreshing ? INVENTORY_TIMEOUT_MS / INVENTORY_POLL_MS : 1

  let entry: GooseProviderEntry | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    entry = await fetchProviderEntry(connection, providerId)
    if (!entry) throw new Error(`goose 不认识供应商「${providerId}」`)
    if (!entry.isRefreshing) return entry
    await new Promise(function (resolve) {
      setTimeout(resolve, INVENTORY_POLL_MS)
    })
  }
  if (!entry) throw new Error(`goose 不认识供应商「${providerId}」`)
  throw new Error(`等待 ${entry.providerName} inventory 刷新超时`)
}

async function refreshProviderInventory(
  connection: ClientConnection,
  providerId: string
): Promise<void> {
  try {
    await connection.agent.request(GOOSE_PROVIDERS_INVENTORY_REFRESH, {
      providerIds: [providerId]
    })
  } catch (error) {
    console.warn('[goose-providers] inventory refresh 跳过:', error)
  }
}

async function saveProviderConfig(
  connection: ClientConnection,
  providerId: string,
  fields: GooseConfigField[]
): Promise<GooseProviderEntry> {
  const response = await connection.agent.request<ConfigSaveResponse>(GOOSE_PROVIDERS_CONFIG_SAVE, {
    providerId,
    fields
  })
  return waitInventoryIdle(connection, providerId, response.refresh)
}

/** ACP 供应商：空 fields 触发 enable（对齐 Desktop acpEnableProvider） */
async function enableAcpProvider(
  connection: ClientConnection,
  providerId: string
): Promise<GooseProviderEntry> {
  return saveProviderConfig(connection, providerId, [])
}

async function checkAcpReadiness(
  connection: ClientConnection,
  providerId: string
): Promise<{ ready: boolean; error: string | null }> {
  const response = await connection.agent.request<ReadinessResponse>(
    GOOSE_PROVIDERS_READINESS_CHECK,
    { providerId }
  )
  return {
    ready: response.ready === true,
    error: response.error ?? null
  }
}

async function fetchDefaults(connection: ClientConnection): Promise<GooseDefaults> {
  const response = await connection.agent.request<DefaultsResponse>(GOOSE_DEFAULTS_READ, {})
  return {
    providerId: response.providerId ?? null,
    modelId: response.modelId ?? null
  }
}

async function saveDefaults(
  connection: ClientConnection,
  providerId: string,
  modelId?: string | null
): Promise<void> {
  await connection.agent.request(GOOSE_DEFAULTS_SAVE, {
    providerId,
    modelId: modelId ?? null
  })
}

async function fetchAutoCompactThreshold(
  connection: ClientConnection
): Promise<number | null> {
  const response = await connection.agent.request<ConfigValueResponse>(GOOSE_CONFIG_READ, {
    key: CONFIG_AUTO_COMPACT_THRESHOLD,
    isSecret: false
  })
  const value = response.value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function saveAutoCompactThreshold(
  connection: ClientConnection,
  threshold: number
): Promise<void> {
  if (!(threshold > 0) || threshold > 1) {
    throw new Error('GOOSE_AUTO_COMPACT_THRESHOLD 须在 (0, 1]')
  }
  await connection.agent.request(GOOSE_CONFIG_UPSERT, {
    key: CONFIG_AUTO_COMPACT_THRESHOLD,
    value: threshold,
    isSecret: false
  })
}

/** 未配置时写入 Desktop 默认 0.8，启用服务端 auto-compact */
async function ensureAutoCompactThreshold(connection: ClientConnection): Promise<void> {
  try {
    const current = await fetchAutoCompactThreshold(connection)
    if (current !== null && current > 0 && current <= 1) return
    await saveAutoCompactThreshold(connection, AUTO_COMPACT_THRESHOLD)
  } catch (error) {
    console.warn('[goose-providers] 写入 auto-compact 阈值跳过:', error)
  }
}

/** 工具权限档：goose `ToolPermissionLevel`（snake_case wire 值） */
type ToolPermissionLevel = 'always_allow' | 'ask_before' | 'never_allow'

/** `tools/list` 返回的单个工具（含当前权限） */
interface SessionTool {
  name: string
  description: string
  parameters: string[]
  permission: ToolPermissionLevel | null
  inputSchema: unknown
  outputSchema?: unknown
}

interface ToolsListResponse {
  tools?: SessionTool[]
}

/** 枚举某会话可用工具及当前权限（`tools/list` 需要 goose session 上下文） */
async function fetchSessionTools(
  connection: ClientConnection,
  sessionId: string
): Promise<SessionTool[]> {
  const response = await connection.agent.request<ToolsListResponse>(GOOSE_TOOLS_LIST, {
    sessionId
  })
  return response.tools ?? []
}

/** 设置一个或多个工具的用户权限（全局，落 permission.yaml） */
async function setToolPermissions(
  connection: ClientConnection,
  toolPermissions: Array<{ toolName: string; permission: ToolPermissionLevel }>
): Promise<void> {
  await connection.agent.request(GOOSE_TOOLS_PERMISSIONS_SET, { toolPermissions })
}

export type {
  GooseConfigField,
  GooseConfigKey,
  GooseDefaults,
  GooseProviderEntry,
  SessionTool,
  ToolPermissionLevel
}
export {
  AUTO_COMPACT_THRESHOLD,
  CONFIG_AUTO_COMPACT_THRESHOLD,
  checkAcpReadiness,
  enableAcpProvider,
  ensureAutoCompactThreshold,
  fetchAutoCompactThreshold,
  fetchDefaults,
  fetchGooseProviders,
  fetchProviderConfig,
  fetchProviderEntry,
  fetchProviderModels,
  findConfiguredProviders,
  findSettingsProviders,
  findSetupProviders,
  parseConfigFields,
  fetchSessionTools,
  refreshProviderInventory,
  saveAutoCompactThreshold,
  saveDefaults,
  saveProviderConfig,
  setToolPermissions
}
