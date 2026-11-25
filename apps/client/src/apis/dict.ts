/**
 * 状态字典。
 *
 * 两段来源：
 * - **云端目录**（cogito `/api/v1/dict`）：成员面拉当前租户合并目录，权威编辑在 backend 管理台；
 * - **本地 SQLite**（`dict:*`）：Rust 侧落库的字典项，离线可读，`POST_DICT_MERGE` 负责把云端目录并进来。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  DictItemSchema,
  DictTypeSchema,
  RemoteCatalogSchema,
  type DictItem,
  type DictType,
  type RemoteCatalog
} from '@/shared/ipc/specs/dict'
import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

// ---------------------------------------------------------------- 云端目录

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

// ---------------------------------------------------------------- 本地字典

function asError(error: unknown, label: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`${label}: ${String(error)}`)
}

async function GET_DICT_ITEMS(typeCode: string, tenantId?: string | null): Promise<DictItem[]> {
  try {
    return DictItemSchema.array().parse(
      await invoke(CHANNELS.DICT.LIST, { typeCode, tenantId: tenantId ?? null })
    )
  } catch (error) {
    throw asError(error, '读取字典失败')
  }
}

async function GET_DICT_TYPES(typeCodes: string[], tenantId?: string | null): Promise<DictType[]> {
  try {
    return DictTypeSchema.array().parse(
      await invoke(CHANNELS.DICT.LIST_BY_TYPES, {
        typeCodes,
        tenantId: tenantId ?? null
      })
    )
  } catch (error) {
    throw asError(error, '读取字典失败')
  }
}

async function PUT_DICT_ITEM(input: {
  id: string
  typeCode?: string
  label?: string
  sort?: number
  enabled?: boolean
  meta?: string
}): Promise<DictItem> {
  try {
    return DictItemSchema.parse(await invoke(CHANNELS.DICT.UPDATE_ITEM, { input }))
  } catch (error) {
    throw asError(error, '更新字典失败')
  }
}

async function GET_DICT_VALUE(typeCode: string, key: string): Promise<string | null> {
  try {
    return await invoke<string | null>(CHANNELS.DICT.FIND_VALUE, { typeCode, key })
  } catch (error) {
    throw asError(error, '解析字典 value 失败')
  }
}

async function POST_DICT_MERGE(catalog: RemoteCatalog): Promise<void> {
  try {
    const parsed = RemoteCatalogSchema.parse(catalog)
    await invoke(CHANNELS.DICT.MERGE_REMOTE, { catalog: parsed })
  } catch (error) {
    throw asError(error, '合并远端字典失败')
  }
}

export type { DictCatalog, DictItem, DictType, DictTypeCatalog, DictTypeItem, RemoteCatalog }
export { GET_DICT_CATALOG, GET_DICT_ITEMS, GET_DICT_TYPES, PUT_DICT_ITEM, GET_DICT_VALUE, POST_DICT_MERGE }
