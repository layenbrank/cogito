import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

/**
 * 租户（多租户身份的唯一入口）。
 *
 * 服务端约定：档位/配额挂在**个人租户**上；团队租户与不带租户身份都回落全局兜底配额。
 * 注册接口本身不建个人租户，客户端在首次解析时用 `POST_TENANT` 补建。
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

interface TenantWriteBody {
  name: string
  /** 唯一标识：小写字母 / 数字 / 中划线 */
  slug: string
  /** PERSONAL / TEAM；缺省 PERSONAL */
  type?: string
}

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

const ENV = { env: 'cogito' as const }

/** 我所属的租户；合法登录用户通常至少有一条个人租户（可由客户端补建） */
function GET_MY_TENANTS(signal?: AbortSignal) {
  return unwrap(http.get<RSF<Tenant[]>>('/tenants', { ...ENV, signal }))
}

/** 创建租户；创建者自动成为 OWNER。用于补建缺失的个人租户。 */
function POST_TENANT(body: TenantWriteBody, signal?: AbortSignal) {
  return unwrap(http.post<RSF<Tenant>>('/tenants', body, { ...ENV, signal }))
}

export { GET_MY_TENANTS, PERSONAL_TENANT, POST_TENANT }
export type { Tenant, TenantWriteBody }
