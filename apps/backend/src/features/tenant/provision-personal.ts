/**
 * 为**存量**用户补开「可走免费配额」的个人租户身份。
 *
 * 免费档只认 `tenant.type = PERSONAL` 且用户是其成员。新用户在注册 / 管理建号 /
 * SSO 新建时已由服务端自动开通；本助手只给历史账号或开通失败时的运维补救。
 *
 * 创建者（当前管理员）会先成为 OWNER（服务端 `create_owned`），再把目标用户
 * 加为 OWNER，这样两端都能进该租户。
 */
import { GET_USER_TENANTS } from '@/apis/user.ts'
import {
  POST_ADMIN_TENANT,
  POST_ADMIN_TENANT_MEMBER,
  type TenantRecord
} from '@/apis/tenant.ts'

function buildPersonalSlug(userID: string): string {
  const stem = userID.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
  const fallback = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `personal-${stem || fallback}`
}

async function findExistingPersonal(userID: string): Promise<string | null> {
  const tenants = await GET_USER_TENANTS(userID)
  const personal = tenants.find(function (tenant) {
    return String(tenant.type ?? '').toUpperCase() === 'PERSONAL'
  })
  return personal?.tenantID ?? null
}

interface ProvisionPersonalInput {
  userID: string
  username: string
}

interface ProvisionPersonalResult {
  tenant: TenantRecord
  /** 已有个人租户时为 true，未新建 */
  alreadyHad: boolean
}

async function provisionPersonalTenant(
  input: ProvisionPersonalInput
): Promise<ProvisionPersonalResult> {
  const existingID = await findExistingPersonal(input.userID)
  if (existingID) {
    return {
      alreadyHad: true,
      tenant: {
        id: existingID,
        name: `${input.username}的个人空间`,
        slug: '',
        status: 'ACTIVE',
        type: 'PERSONAL',
        createdAt: 0,
        updatedAt: 0
      }
    }
  }

  async function create(slug: string): Promise<TenantRecord> {
    return POST_ADMIN_TENANT({
      name: `${input.username}的个人空间`,
      slug,
      type: 'PERSONAL'
    })
  }

  let tenant: TenantRecord
  try {
    tenant = await create(buildPersonalSlug(input.userID))
  } catch (firstError) {
    try {
      tenant = await create(`personal-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`)
    } catch (secondError) {
      throw firstError instanceof Error ? firstError : secondError
    }
  }

  await POST_ADMIN_TENANT_MEMBER(tenant.id, {
    userID: input.userID,
    role: 'OWNER'
  })

  return { tenant, alreadyHad: false }
}

export { findExistingPersonal, provisionPersonalTenant }
export type { ProvisionPersonalInput, ProvisionPersonalResult }
