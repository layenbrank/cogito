/**
 * 状态字典 IPC。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  DictItemSchema,
  DictTypeSchema,
  type DictItem,
  type DictType
} from '@/shared/ipc/specs/dict'

function asError(error: unknown, label: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`${label}: ${String(error)}`)
}

async function listDictItems(typeCode: string): Promise<DictItem[]> {
  try {
    return DictItemSchema.array().parse(
      await invoke(CHANNELS.DICT.LIST, { typeCode })
    )
  } catch (error) {
    throw asError(error, '读取字典失败')
  }
}

async function listDictByTypes(typeCodes: string[]): Promise<DictType[]> {
  try {
    return DictTypeSchema.array().parse(
      await invoke(CHANNELS.DICT.LIST_BY_TYPES, { typeCodes })
    )
  } catch (error) {
    throw asError(error, '读取字典失败')
  }
}

async function updateDictItem(input: {
  id: string
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

export { listDictItems, listDictByTypes, updateDictItem }
