/**
 * 状态字典 IPC。
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

function asError(error: unknown, label: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`${label}: ${String(error)}`)
}

async function listDictItems(typeCode: string, tenantId?: string | null): Promise<DictItem[]> {
  try {
    return DictItemSchema.array().parse(
      await invoke(CHANNELS.DICT.LIST, { typeCode, tenantId: tenantId ?? null })
    )
  } catch (error) {
    throw asError(error, '读取字典失败')
  }
}

async function listDictByTypes(
  typeCodes: string[],
  tenantId?: string | null
): Promise<DictType[]> {
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

async function updateDictItem(input: {
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

async function findDictValueIpc(typeCode: string, key: string): Promise<string | null> {
  try {
    const value = await invoke<string | null>(CHANNELS.DICT.FIND_VALUE, { typeCode, key })
    return value
  } catch (error) {
    throw asError(error, '解析字典 value 失败')
  }
}

async function mergeRemoteDict(catalog: RemoteCatalog): Promise<void> {
  try {
    const parsed = RemoteCatalogSchema.parse(catalog)
    await invoke(CHANNELS.DICT.MERGE_REMOTE, { catalog: parsed })
  } catch (error) {
    throw asError(error, '合并远端字典失败')
  }
}

export {
  listDictItems,
  listDictByTypes,
  updateDictItem,
  findDictValueIpc,
  mergeRemoteDict
}
