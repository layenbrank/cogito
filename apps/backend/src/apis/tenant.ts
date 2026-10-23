import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface TenantRecord {
  id: string
  name: string
  slug: string
  status: string
  type: string
  createdAt: number
  updatedAt: number
}

interface TenantSummary extends TenantRecord {
  memberCount: number
}

interface TenantMember {
  id: string
  tenantID: string
  userID: string
  role: string
  status: string
  username?: string | null
  email?: string | null
}

interface TenantSubscription {
  id: string
  tenantID: string
  plan: string
  status: string
  expiresAt: number | null
  createdAt: number
  updatedAt: number
}

interface TenantQuota {
  tenantID: string
  type: string
  source: string
  plan: string | null
  dailyTokenQuota: number
}

interface TenantAudit {
  id: string
  tenantID?: string | null
  actor: string
  action: string
  resource: string
  detail?: unknown
  ip?: string | null
  createdAt: number
}

interface TenantDetail extends TenantSummary {
  members: TenantMember[]
  subscriptions: TenantSubscription[]
  quota: TenantQuota | null
  recentAudit: TenantAudit[]
}

interface TenantPage {
  items: TenantSummary[]
  count: number
  page: number
  size: number
  total: number
  next: boolean
  prev: boolean
}

interface TenantQuery {
  q?: string
  type?: string
  status?: string
  page?: number
  size?: number
}

interface TenantWrite {
  name: string
  slug: string
  type?: string
}

interface TenantUpdate {
  name?: string
  status?: string
  type?: string
}

interface MemberWrite {
  userID: string
  role: string
}

interface MemberUpdate {
  role?: string
  status?: string
}

interface SubscribeWrite {
  plan: string
  expiresAt?: number | null
}

const ENV = { env: 'cogito' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

/** 我的租户（当前用户所属，非全平台） */
function GET_MY_TENANTS() {
  return unwrap(http.get<RSF<TenantRecord[]>>('/tenants', ENV))
}

function GET_ADMIN_TENANTS(query: TenantQuery = {}) {
  return unwrap(
    http.get<RSF<TenantPage>>('/admin/tenants', {
      ...ENV,
      query: {
        q: query.q || undefined,
        type: query.type || undefined,
        status: query.status || undefined,
        page: query.page,
        size: query.size
      }
    })
  )
}

function GET_ADMIN_TENANT(id: string) {
  return unwrap(http.get<RSF<TenantDetail>>(`/admin/tenants/${id}`, ENV))
}

function POST_ADMIN_TENANT(body: TenantWrite) {
  return unwrap(http.post<RSF<TenantRecord>>('/admin/tenants', body, ENV))
}

function PUT_ADMIN_TENANT(id: string, body: TenantUpdate) {
  return unwrap(http.put<RSF<TenantRecord>>(`/admin/tenants/${id}`, body, ENV))
}

function DELETE_ADMIN_TENANT(id: string) {
  return unwrap(http.delete<RSF<null>>(`/admin/tenants/${id}`, ENV))
}

function GET_ADMIN_TENANT_MEMBERS(id: string) {
  return unwrap(http.get<RSF<TenantMember[]>>(`/admin/tenants/${id}/members`, ENV))
}

function POST_ADMIN_TENANT_MEMBER(id: string, body: MemberWrite) {
  return unwrap(http.post<RSF<TenantMember>>(`/admin/tenants/${id}/members`, body, ENV))
}

function PUT_ADMIN_TENANT_MEMBER(id: string, userID: string, body: MemberUpdate) {
  return unwrap(
    http.put<RSF<TenantMember>>(`/admin/tenants/${id}/members/${userID}`, body, ENV)
  )
}

function DELETE_ADMIN_TENANT_MEMBER(id: string, userID: string) {
  return unwrap(http.delete<RSF<null>>(`/admin/tenants/${id}/members/${userID}`, ENV))
}

function GET_ADMIN_TENANT_SUBSCRIPTIONS(id: string) {
  return unwrap(
    http.get<RSF<TenantSubscription[]>>(`/admin/tenants/${id}/subscriptions`, ENV)
  )
}

function POST_ADMIN_TENANT_SUBSCRIPTION(id: string, body: SubscribeWrite) {
  return unwrap(
    http.post<RSF<TenantSubscription>>(`/admin/tenants/${id}/subscriptions`, body, ENV)
  )
}

function GET_ADMIN_TENANT_QUOTA(id: string) {
  return unwrap(http.get<RSF<TenantQuota>>(`/admin/tenants/${id}/quota`, ENV))
}

export {
  DELETE_ADMIN_TENANT,
  DELETE_ADMIN_TENANT_MEMBER,
  GET_ADMIN_TENANT,
  GET_ADMIN_TENANT_MEMBERS,
  GET_ADMIN_TENANT_QUOTA,
  GET_ADMIN_TENANT_SUBSCRIPTIONS,
  GET_ADMIN_TENANTS,
  GET_MY_TENANTS,
  POST_ADMIN_TENANT,
  POST_ADMIN_TENANT_MEMBER,
  POST_ADMIN_TENANT_SUBSCRIPTION,
  PUT_ADMIN_TENANT,
  PUT_ADMIN_TENANT_MEMBER
}
export type {
  MemberUpdate,
  MemberWrite,
  SubscribeWrite,
  TenantAudit,
  TenantDetail,
  TenantMember,
  TenantPage,
  TenantQuery,
  TenantQuota,
  TenantRecord,
  TenantSubscription,
  TenantSummary,
  TenantUpdate,
  TenantWrite
}
