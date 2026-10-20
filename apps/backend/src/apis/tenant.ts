import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface TenantRecord {
  id: string
  name: string
  kind: string
  status: string
  createdAt: number
  updatedAt: number
}

interface TenantMember {
  userID: string
  role: string
  status: string
  username?: string
}

const ENV = { env: 'thinking' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

function GET_TENANTS() {
  return unwrap(http.get<RSF<TenantRecord[]>>('/tenants', ENV))
}

function GET_TENANT(id: string) {
  return unwrap(http.get<RSF<TenantRecord>>(`/tenants/${id}`, ENV))
}

function GET_TENANT_MEMBERS(id: string) {
  return unwrap(http.get<RSF<TenantMember[]>>(`/tenants/${id}/members`, ENV))
}

export { GET_TENANT, GET_TENANT_MEMBERS, GET_TENANTS }
export type { TenantMember, TenantRecord }
