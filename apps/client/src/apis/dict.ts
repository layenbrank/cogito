/**
 * 产品状态字典（cogito `/api/v1/dict`）。
 * 成员面拉当前租户合并目录；权威编辑在 backend 管理台。
 */
import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

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

interface DictTypeCatalog {
  code: string
  name: string
  description: string | null
  items: DictTypeItem[]
}

interface DictCatalog {
  revision: number
  types: DictTypeCatalog[]
}

const ENV = { env: 'cogito' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

/** 当前租户合并目录（需登录 + 租户头） */
function GET_DICT_CATALOG(signal?: AbortSignal): Promise<DictCatalog> {
  return unwrap(http.get<RSF<DictCatalog>>('/dict', { ...ENV, signal }))
}

export type { DictTypeItem, DictTypeCatalog, DictCatalog }
export { GET_DICT_CATALOG }
