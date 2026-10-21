import { HttpEnvelope } from '@/utils/http/errors.ts'
import { downloadFile } from '@/utils/http/download.ts'
import { http } from '@/utils/http/http.ts'

interface GatewayProvider {
  id: string
  kind: string
  name: string
  baseUrl: string
  status: string
  hasApiKey: boolean
  createdAt: number
  updatedAt: number
}

interface ProviderWrite {
  kind: string
  name: string
  baseUrl: string
  apiKey?: string
  status?: string
}

interface ProviderUpdate {
  kind?: string
  name?: string
  baseUrl?: string
  apiKey?: string
  status?: string
}

interface GatewayModel {
  id: string
  providerID: string
  name: string
  label: string
  allowRoles: string[] | null
  enabled: boolean
  dailyTokenQuota: number
  capabilities?: Record<string, unknown> | null
  contextWindow?: number | null
  providerName?: string
  createdAt: number
  updatedAt: number
}

interface ModelWrite {
  providerID: string
  name: string
  label: string
  allowRoles?: string[]
  enabled?: boolean
  dailyTokenQuota?: number
  capabilities?: Record<string, unknown> | null
  contextWindow?: number | null
}

interface ModelUpdate {
  name?: string
  label?: string
  allowRoles?: string[]
  enabled?: boolean
  dailyTokenQuota?: number
  capabilities?: Record<string, unknown> | null
  contextWindow?: number | null
}

interface UsageQuery {
  tenantID?: string
  modelID?: string
  from?: number
  to?: number
  page?: number
  size?: number
}

interface UsageRecord {
  id: string
  tenantID: string | null
  userID: string
  modelID: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  status: string
  latencyMs: number
  createdAt: number
}

interface AuditQuery {
  tenantID?: string
  actor?: string
  action?: string
  from?: number
  to?: number
  page?: number
  size?: number
}

interface AuditRecord {
  id: string
  tenantID: string | null
  actor: string
  action: string
  resource: string
  detail: string | null
  ip: string | null
  createdAt: number
}

/** 服务端分页信封：`count` 是总条数，`total` 是总页数 */
interface GatewayPaginated<T> {
  items: T[]
  count: number
  page: number
  size: number
  total: number
  next: boolean
  prev: boolean
}

const ENV = { env: 'thinking' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

function GET_GATEWAY_PROVIDERS() {
  return unwrap(http.get<RSF<GatewayProvider[]>>('/gateway/providers', ENV))
}

function POST_GATEWAY_PROVIDER(body: ProviderWrite) {
  return unwrap(http.post<RSF<GatewayProvider>>('/gateway/providers', body, ENV))
}

function PUT_GATEWAY_PROVIDER(id: string, body: ProviderUpdate) {
  return unwrap(http.put<RSF<GatewayProvider>>(`/gateway/providers/${id}`, body, ENV))
}

function DELETE_GATEWAY_PROVIDER(id: string) {
  return unwrap(http.delete<RSF<null>>(`/gateway/providers/${id}`, ENV))
}

function GET_GATEWAY_ADMIN_MODELS() {
  return unwrap(http.get<RSF<GatewayModel[]>>('/gateway/admin/models', ENV))
}

function POST_GATEWAY_ADMIN_MODEL(body: ModelWrite) {
  return unwrap(http.post<RSF<GatewayModel>>('/gateway/admin/models', body, ENV))
}

function PUT_GATEWAY_ADMIN_MODEL(id: string, body: ModelUpdate) {
  return unwrap(http.put<RSF<GatewayModel>>(`/gateway/admin/models/${id}`, body, ENV))
}

function DELETE_GATEWAY_ADMIN_MODEL(id: string) {
  return unwrap(http.delete<RSF<null>>(`/gateway/admin/models/${id}`, ENV))
}

function GET_GATEWAY_USAGE(query: UsageQuery = {}) {
  return unwrap(http.get<RSF<GatewayPaginated<UsageRecord>>>('/gateway/usage', { ...ENV, query }))
}

function GET_GATEWAY_AUDIT(query: AuditQuery = {}) {
  return unwrap(http.get<RSF<GatewayPaginated<AuditRecord>>>('/gateway/audit', { ...ENV, query }))
}

function EXPORT_GATEWAY_AUDIT(query: AuditQuery & { format?: 'csv' | 'ndjson' } = {}) {
  const { format = 'csv', ...rest } = query
  return downloadFile('/gateway/audit/export', `gateway-audit.${format}`, {
    ...rest,
    format
  })
}

export {
  DELETE_GATEWAY_ADMIN_MODEL,
  DELETE_GATEWAY_PROVIDER,
  EXPORT_GATEWAY_AUDIT,
  GET_GATEWAY_ADMIN_MODELS,
  GET_GATEWAY_AUDIT,
  GET_GATEWAY_PROVIDERS,
  GET_GATEWAY_USAGE,
  POST_GATEWAY_ADMIN_MODEL,
  POST_GATEWAY_PROVIDER,
  PUT_GATEWAY_ADMIN_MODEL,
  PUT_GATEWAY_PROVIDER
}
export type {
  AuditQuery,
  AuditRecord,
  GatewayModel,
  GatewayPaginated,
  GatewayProvider,
  ModelUpdate,
  ModelWrite,
  ProviderUpdate,
  ProviderWrite,
  UsageQuery,
  UsageRecord
}
