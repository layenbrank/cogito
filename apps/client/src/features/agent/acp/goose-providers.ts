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
const CONFIG_TEMPERATURE = 'GOOSE_TEMPERATURE'
/** 思考强度：goose 全局键，枚举 off/low/medium/high/max（与 cogito 五档同名） */
const CONFIG_THINKING_EFFORT = 'GOOSE_THINKING_EFFORT'
const THINKING_EFFORTS = ['off', 'low', 'medium', 'high', 'max'] as const

const INVENTORY_POLL_MS = 100
const INVENTORY_TIMEOUT_MS = 30_000

interface GooseConfigKey {
  name: string
  required: boolean
  secret: boolean
  /** 预填默认值；没有就是 null（解析后一定存在，省掉调用点的 `?.` 分支） */
  default: string | null
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

/** 线缆值：goose 的响应一律当不可信输入（字段可能缺失、为 null 或给出别的类型） */
type Wire = Record<string, unknown>

function asWire(value: unknown): Wire {
  return typeof value === 'object' && value !== null ? (value as Wire) : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 字符串数组：丢掉非字符串与空值 */
function asTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asText).filter(Boolean)
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}

function parseConfigKey(value: unknown): GooseConfigKey | null {
  const row = asWire(value)
  const name = asText(row.name)
  if (!name) return null
  return {
    name,
    required: row.required === true,
    secret: row.secret === true,
    default: asText(row.default) || null
  }
}

function parseConfigKeys(value: unknown): GooseConfigKey[] {
  if (!Array.isArray(value)) return []
  return value.map(parseConfigKey).filter(isPresent)
}

/** `providers/config/read` 的一行（secret 原样保留，不做 trim） */
function parseConfigField(value: unknown): GooseConfigField | null {
  const row = asWire(value)
  const key = asText(row.key)
  if (!key) return null
  return { key, value: typeof row.value === 'string' ? row.value : '' }
}

function parseReadFields(value: unknown): GooseConfigField[] {
  if (!Array.isArray(value)) return []
  return value.map(parseConfigField).filter(isPresent)
}

function parseModelID(value: unknown): string {
  const row = asWire(value)
  return asText(row.id) || asText(row.name)
}

function parseModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(parseModelID).filter(Boolean)
}

function parseProviderEntry(value: unknown): GooseProviderEntry | null {
  const row = asWire(value)
  const providerId = asText(row.providerId)
  if (!providerId) return null
  return {
    providerId,
    providerName: asText(row.providerName) || providerId,
    description: asText(row.description),
    configured: row.configured === true,
    available: row.available !== false,
    visibleInSetup: row.visibleInSetup === true,
    isAcp: row.acp === true,
    isRefreshing: row.refreshing === true,
    defaultModel: asText(row.defaultModel) || null,
    configKeys: parseConfigKeys(row.configKeys),
    models: parseModels(row.models),
    setupSteps: asTexts(row.setupSteps)
  }
}

function parseEntries(value: unknown): GooseProviderEntry[] {
  if (!Array.isArray(value)) return []
  return value.map(parseProviderEntry).filter(isPresent)
}

/** save 之后这个供应商是否正在（或已在）刷新 inventory：决定要不要轮询等待 */
function isRefreshPending(value: unknown, providerId: string): boolean {
  const row = asWire(value)
  if (asTexts(row.started).includes(providerId)) return true
  if (!Array.isArray(row.skipped)) return false
  return row.skipped.some(function (item) {
    const entry = asWire(item)
    return asText(entry.providerId) === providerId && asText(entry.reason) === 'already_refreshing'
  })
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
  const response = asWire(await connection.agent.request<unknown>(GOOSE_PROVIDERS_LIST, params))
  return parseEntries(response.entries)
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
  const response = asWire(
    await connection.agent.request<unknown>(GOOSE_PROVIDERS_CONFIG_READ, { providerId })
  )
  return parseReadFields(response.fields)
}

async function waitInventoryIdle(
  connection: ClientConnection,
  providerId: string,
  refresh: unknown
): Promise<GooseProviderEntry> {
  const attempts = isRefreshPending(refresh, providerId)
    ? INVENTORY_TIMEOUT_MS / INVENTORY_POLL_MS
    : 1

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
  const response = asWire(
    await connection.agent.request<unknown>(GOOSE_PROVIDERS_CONFIG_SAVE, { providerId, fields })
  )
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
  const response = asWire(
    await connection.agent.request<unknown>(GOOSE_PROVIDERS_READINESS_CHECK, { providerId })
  )
  return {
    ready: response.ready === true,
    error: asText(response.error) || null
  }
}

async function fetchDefaults(connection: ClientConnection): Promise<GooseDefaults> {
  const response = asWire(await connection.agent.request<unknown>(GOOSE_DEFAULTS_READ, {}))
  return {
    providerId: asText(response.providerId) || null,
    modelId: asText(response.modelId) || null
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

async function fetchAutoCompactThreshold(connection: ClientConnection): Promise<number | null> {
  const response = asWire(
    await connection.agent.request<unknown>(GOOSE_CONFIG_READ, {
      key: CONFIG_AUTO_COMPACT_THRESHOLD,
      isSecret: false
    })
  )
  return asNumber(response.value)
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

/** 读已配置的生成温度（未配置返回 null，表示走模型默认） */
async function fetchTemperature(connection: ClientConnection): Promise<number | null> {
  const response = asWire(
    await connection.agent.request<unknown>(GOOSE_CONFIG_READ, {
      key: CONFIG_TEMPERATURE,
      isSecret: false
    })
  )
  return asNumber(response.value)
}

/** 写生成温度（goose 全局配置，对新会话生效；调用方负责钳到 0–1） */
async function saveTemperature(connection: ClientConnection, temperature: number): Promise<void> {
  await connection.agent.request(GOOSE_CONFIG_UPSERT, {
    key: CONFIG_TEMPERATURE,
    value: temperature,
    isSecret: false
  })
}

/** 读已配置的思考强度（未配置返回 null，表示走模型默认） */
async function fetchThinkingEffort(connection: ClientConnection): Promise<string | null> {
  const response = asWire(
    await connection.agent.request<unknown>(GOOSE_CONFIG_READ, {
      key: CONFIG_THINKING_EFFORT,
      isSecret: false
    })
  )
  const value = response.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 写思考强度（goose 全局配置，对新会话生效）；取值不在五档内直接拒绝，不写脏数据 */
async function saveThinkingEffort(connection: ClientConnection, effort: string): Promise<void> {
  const value = effort.trim().toLowerCase()
  const allowed = THINKING_EFFORTS.some(function (item) {
    return item === value
  })
  if (!allowed) throw new Error(`GOOSE_THINKING_EFFORT 只接受 ${THINKING_EFFORTS.join('/')}`)
  await connection.agent.request(GOOSE_CONFIG_UPSERT, {
    key: CONFIG_THINKING_EFFORT,
    value,
    isSecret: false
  })
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
async function writeToolPermissions(
  connection: ClientConnection,
  toolPermissions: Array<{ toolName: string; permission: ToolPermissionLevel }>
): Promise<void> {
  await connection.agent.request(GOOSE_TOOLS_PERMISSIONS_SET, { toolPermissions })
}

export {
  AUTO_COMPACT_THRESHOLD,
  checkAcpReadiness,
  CONFIG_AUTO_COMPACT_THRESHOLD,
  CONFIG_TEMPERATURE,
  CONFIG_THINKING_EFFORT,
  enableAcpProvider,
  ensureAutoCompactThreshold,
  fetchAutoCompactThreshold,
  fetchDefaults,
  fetchGooseProviders,
  fetchProviderConfig,
  fetchProviderEntry,
  fetchProviderModels,
  fetchSessionTools,
  fetchTemperature,
  fetchThinkingEffort,
  findConfiguredProviders,
  findSettingsProviders,
  findSetupProviders,
  parseConfigFields,
  refreshProviderInventory,
  saveAutoCompactThreshold,
  saveDefaults,
  saveProviderConfig,
  saveTemperature,
  saveThinkingEffort,
  writeToolPermissions
}
export type {
  GooseConfigField,
  GooseConfigKey,
  GooseDefaults,
  GooseProviderEntry,
  SessionTool,
  ToolPermissionLevel
}
