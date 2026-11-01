import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface DictItem {
  value: string
  key: string
  label: string
  sort: number
  enabled: boolean
  meta: string | null
  revision: number
}

interface DictTypeItem {
  value: string
  key: string
  label: string
  sort: number
  enabled: boolean
  isDefault: boolean
  meta: string | null
  revision: number
}

interface DictType {
  code: string
  name: string
  description: string | null
  items: DictTypeItem[]
}

interface DictTypeWrite {
  code: string
  name: string
  description?: string | null
}

interface DictTypeUpdate {
  name: string
  description?: string | null
}

interface DictItemAllocate {
  key: string
  label: string
  sort?: number
  meta?: string | null
}

interface DictItemUpdate {
  label?: string
  sort?: number
  enabled?: boolean
  meta?: string | null
}

interface DictClaim {
  value: string
  isDefault: boolean
  sort: number
  label?: string | null
}

interface DictTenantItemWrite {
  typeCode: string
  value: string
  label?: string | null
  enabled?: boolean | null
}

interface DictTenantView {
  tenantID: string
  revision: number
  types: DictType[]
}

const ENV = { env: 'cogito' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

function GET_DICT_TYPES() {
  return unwrap(http.get<RSF<DictType[]>>('/dict/types', ENV))
}

function POST_DICT_TYPE(body: DictTypeWrite) {
  return unwrap(http.post<RSF<DictType>>('/dict/types', body, ENV))
}

function PUT_DICT_TYPE(code: string, body: DictTypeUpdate) {
  return unwrap(http.put<RSF<DictType>>(`/dict/types/${encodeURIComponent(code)}`, body, ENV))
}

function GET_DICT_ITEMS() {
  return unwrap(http.get<RSF<DictItem[]>>('/dict/items', ENV))
}

function POST_DICT_ITEM_ALLOCATE(body: DictItemAllocate) {
  return unwrap(http.post<RSF<DictItem>>('/dict/items/allocate', body, ENV))
}

function PUT_DICT_ITEM(value: string, body: DictItemUpdate) {
  return unwrap(http.put<RSF<DictItem>>(`/dict/items/${encodeURIComponent(value)}`, body, ENV))
}

function POST_DICT_CLAIMS(code: string, body: DictClaim[]) {
  return unwrap(
    http.post<RSF<DictTypeItem[]>>(
      `/dict/types/${encodeURIComponent(code)}/claims`,
      body,
      ENV
    )
  )
}

function DELETE_DICT_CLAIM(code: string, value: string) {
  return unwrap(
    http.delete<RSF<null>>(
      `/dict/types/${encodeURIComponent(code)}/claims/${encodeURIComponent(value)}`,
      ENV
    )
  )
}

function GET_DICT_TENANT(tenantId: string) {
  return unwrap(
    http.get<RSF<DictTenantView>>(`/dict/tenants/${encodeURIComponent(tenantId)}`, ENV)
  )
}

function PUT_DICT_TENANT_ITEMS(tenantId: string, body: DictTenantItemWrite[]) {
  return unwrap(
    http.put<RSF<null>>(`/dict/tenants/${encodeURIComponent(tenantId)}/items`, body, ENV)
  )
}

export {
  DELETE_DICT_CLAIM,
  GET_DICT_ITEMS,
  GET_DICT_TENANT,
  GET_DICT_TYPES,
  POST_DICT_CLAIMS,
  POST_DICT_ITEM_ALLOCATE,
  POST_DICT_TYPE,
  PUT_DICT_ITEM,
  PUT_DICT_TENANT_ITEMS,
  PUT_DICT_TYPE
}
export type {
  DictClaim,
  DictItem,
  DictItemAllocate,
  DictItemUpdate,
  DictTenantItemWrite,
  DictTenantView,
  DictType,
  DictTypeItem,
  DictTypeUpdate,
  DictTypeWrite
}
