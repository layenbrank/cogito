/**
 * 状态字典缓存：value → label；业务请求只传 value，UI 渲染 label。
 */
import { create } from 'zustand'

import { listDictByTypes, updateDictItem } from '@/lib/dict-ipc'
import { DICT_TYPE, type DictItem, type DictType } from '@/shared/ipc/specs/dict'
import { reportCaught } from '@/utils/exception-report'

type DictCache = Record<string, DictItem[]>

interface DictState {
  byType: DictCache
  isReady: boolean
  isLoading: boolean
  error: string | null
  bootstrap: (typeCodes?: string[]) => Promise<void>
  findLabel: (typeCode: string, value: string | null | undefined) => string
  findItem: (typeCode: string, value: string | null | undefined) => DictItem | null
  updateLabel: (id: string, label: string) => Promise<boolean>
}

const ALL_TYPES = Object.values(DICT_TYPE)

const useDictStore = create<DictState>()(function (setter, getter) {
  return {
    byType: {},
    isReady: false,
    isLoading: false,
    error: null,

    async bootstrap(typeCodes) {
      const codes = typeCodes?.length ? typeCodes : [...ALL_TYPES]
      setter({ isLoading: true, error: null })
      try {
        const types: DictType[] = await listDictByTypes(codes)
        const byType: DictCache = { ...getter().byType }
        for (const type of types) {
          byType[type.typeCode] = type.items
        }
        setter({ byType, isReady: true, isLoading: false })
      } catch (error) {
        reportCaught('dict.bootstrap', error, 'warning')
        setter({
          isLoading: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    },

    findLabel(typeCode, value) {
      if (!value) return '—'
      const item = getter().findItem(typeCode, value)
      return item?.label ?? value
    },

    findItem(typeCode, value) {
      if (!value) return null
      const items = getter().byType[typeCode] ?? []
      return (
        items.find(function (item) {
          return item.value === value
        }) ?? null
      )
    },

    async updateLabel(id, label) {
      try {
        const updated = await updateDictItem({ id, label })
        const items = getter().byType[updated.typeCode] ?? []
        setter({
          byType: {
            ...getter().byType,
            [updated.typeCode]: items.map(function (item) {
              return item.id === updated.id ? updated : item
            })
          }
        })
        return true
      } catch (error) {
        reportCaught('dict.updateLabel', error, 'warning')
        return false
      }
    }
  }
})

function findDictLabel(typeCode: string, value: string | null | undefined): string {
  return useDictStore.getState().findLabel(typeCode, value)
}

export { useDictStore, findDictLabel, ALL_TYPES }
