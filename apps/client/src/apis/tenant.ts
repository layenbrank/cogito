import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

/**
 * 租户（多租户身份的唯一入口）。
 *
 * 关键约定（服务端 `services/tenant`）：注册时会自动建**个人租户**，档位/配额只挂在它上面；
 * 团队租户与不带租户身份都回落全局兜底配额。
 */

/** 租户类型；只有个人租户能订阅档位 */
const PERSONAL_TENANT = 'PERSONAL'

interface Tenant {
  id: string
  name: string
  slug: string
  status: string
  type: string
  createdAt: number
  updatedAt: number
}

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

const ENV = { env: 'thinking' as const }

/** 我所属的租户：注册时会自动建个人租户，所以正常情况下至少一条 */
function GET_MY_TENANTS(signal?: AbortSignal) {
  return unwrap(http.get<RSF<Tenant[]>>('/tenants', { ...ENV, signal }))
}

export { GET_MY_TENANTS, PERSONAL_TENANT }
export type { Tenant }
