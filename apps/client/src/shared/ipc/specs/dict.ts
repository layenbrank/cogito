/**
 * 状态字典 IPC 契约（全局池 value + 稳定 key，label 可改文案）。
 */
import {
  DICT_CLAIMS,
  DICT_KEY,
  DICT_TYPE as DICT_TYPE_CONTRACT,
  DICT_VALUE_BY_KEY,
  findDictValue,
  type DictKey
} from '@cogito/dict'
import { z } from 'zod'

const DictItemSchema = z.object({
  id: z.string(),
  typeCode: z.string(),
  value: z.string(),
  key: z.string(),
  label: z.string(),
  sort: z.number(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  meta: z.string().nullish(),
  revision: z.number()
})

const DictTypeSchema = z.object({
  typeCode: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  items: z.array(DictItemSchema)
})

const RemotePoolItemSchema = z.object({
  value: z.string(),
  key: z.string(),
  label: z.string().nullish(),
  sort: z.number(),
  enabled: z.boolean(),
  meta: z.string().nullish(),
  revision: z.number()
})

const RemoteClaimItemSchema = z.object({
  typeCode: z.string(),
  value: z.string(),
  label: z.string().nullish(),
  isDefault: z.boolean(),
  sort: z.number()
})

const RemoteTenantItemSchema = z.object({
  tenantId: z.string(),
  typeCode: z.string(),
  value: z.string(),
  label: z.string().nullish(),
  enabled: z.boolean().nullish()
})

const RemoteCatalogSchema = z.object({
  pool: z.array(RemotePoolItemSchema),
  claims: z.array(RemoteClaimItemSchema),
  tenantItems: z.array(RemoteTenantItemSchema).optional()
})

type DictItem = z.infer<typeof DictItemSchema>
type DictType = z.infer<typeof DictTypeSchema>
type RemoteCatalog = z.infer<typeof RemoteCatalogSchema>

const DICT_TYPE = DICT_TYPE_CONTRACT

/** 按 type 认领校验后解析全局 value（未认领该 key 则 undefined） */
function findDictValueForType(typeCode: string, key: DictKey | string): string | undefined {
  const value = findDictValue(key)
  if (!value) return undefined
  const claims = DICT_CLAIMS[typeCode]
  if (!claims) return undefined
  return claims.some(function (claim) {
    return claim.value === value
  })
    ? value
    : undefined
}

export type { DictItem, DictType, DictKey, RemoteCatalog }
export {
  DictItemSchema,
  DictTypeSchema,
  RemoteCatalogSchema,
  DICT_TYPE,
  DICT_KEY,
  DICT_VALUE_BY_KEY,
  findDictValue,
  findDictValueForType
}
