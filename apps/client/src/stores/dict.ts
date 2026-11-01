/**
 * 状态字典缓存：冷启动本地 seed，登录后按 revision 合并远端（server wins）。
 */
import { create } from 'zustand'

import { GET_DICT_CATALOG } from '@/apis/dict'
import { listDictByTypes, mergeRemoteDict } from '@/lib/dict-ipc'
import { DICT_TYPE, type DictItem, type DictType, type RemoteCatalog } from '@/shared/ipc/specs/dict'
import { findActiveTenantID } from '@/utils/tenant'
import { findAuthToken } from '@/utils/auth'
import { reportCaught } from '@/utils/exception-report'

type DictCache = Record<string, DictItem[]>

interface DictState {
  byType: DictCache
  isReady: boolean
  isLoading: boolean
  isSyncing: boolean
  remoteRevision: number | null
  error: string | null
  bootstrap: (typeCodes?: string[]) => Promise<void>
  /** 拉取远端并 merge 到本地，再刷新缓存；无登录时跳过 */
  syncRemote: () => Promise<void>
  findLabel: (typeCode: string, value: string | null | undefined) => string
  findItem: (typeCode: string, value: string | null | undefined) => DictItem | null
}

const ALL_TYPES = Object.values(DICT_TYPE)

function catalogToRemote(types: DictType[]): RemoteCatalog {
  const poolByValue = new Map<
    string,
    {
      value: string
      key: string
      label: string | null
      sort: number
      enabled: boolean
      meta: string | null
      revision: number
    }
  >()
  const claims: RemoteCatalog['claims'] = []

  for (const type of types) {
    for (const item of type.items) {
      claims.push({
        typeCode: type.typeCode,
        value: item.value,
        label: item.label,
        isDefault: item.isDefault,
        sort: item.sort
      })
      const prev = poolByValue.get(item.value)
      if (!prev || item.revision >= prev.revision) {
        poolByValue.set(item.value, {
          value: item.value,
          key: item.key,
          label: item.label,
          sort: item.sort,
          enabled: item.enabled,
          meta: item.meta ?? null,
          revision: item.revision
        })
      }
    }
  }

  return {
    pool: [...poolByValue.values()],
    claims,
    tenantItems: []
  }
}

/** 服务端 CatalogR → merge 载荷（含租户已合并 label） */
function serviceCatalogToRemote(
  types: Array<{
    code: string
    items: Array<{
      value: string
      key: string
      label: string
      sort: number
      enabled: boolean
      isDefault: boolean
      meta: string | null
      revision: number
    }>
  }>,
  tenantId: string | null
): RemoteCatalog {
  const poolByValue = new Map<
    string,
    {
      value: string
      key: string
      label: string | null
      sort: number
      enabled: boolean
      meta: string | null
      revision: number
    }
  >()
  const claims: RemoteCatalog['claims'] = []
  const tenantItems: NonNullable<RemoteCatalog['tenantItems']> = []

  for (const type of types) {
    for (const item of type.items) {
      claims.push({
        typeCode: type.code,
        value: item.value,
        label: null,
        isDefault: item.isDefault,
        sort: item.sort
      })
      const prev = poolByValue.get(item.value)
      if (!prev || item.revision >= prev.revision) {
        poolByValue.set(item.value, {
          value: item.value,
          key: item.key,
          label: item.label,
          sort: item.sort,
          enabled: item.enabled,
          meta: item.meta,
          revision: item.revision
        })
      }
      if (tenantId) {
        tenantItems.push({
          tenantId,
          typeCode: type.code,
          value: item.value,
          label: item.label,
          enabled: item.enabled
        })
      }
    }
  }

  return {
    pool: [...poolByValue.values()],
    claims,
    tenantItems
  }
}

const useDictStore = create<DictState>()(function (setter, getter) {
  return {
    byType: {},
    isReady: false,
    isLoading: false,
    isSyncing: false,
    remoteRevision: null,
    error: null,

    async bootstrap(typeCodes) {
      const codes = typeCodes?.length ? typeCodes : [...ALL_TYPES]
      const tenantId = findActiveTenantID()
      setter({ isLoading: true, error: null })
      try {
        const types: DictType[] = await listDictByTypes(codes, tenantId)
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

    async syncRemote() {
      if (!findAuthToken()) return
      if (getter().isSyncing) return
      setter({ isSyncing: true, error: null })
      try {
        const catalog = await GET_DICT_CATALOG()
        const tenantId = findActiveTenantID()
        const remote = serviceCatalogToRemote(catalog.types, tenantId)
        await mergeRemoteDict(remote)
        const codes = [...ALL_TYPES]
        const types = await listDictByTypes(codes, tenantId)
        const byType: DictCache = {}
        for (const type of types) {
          byType[type.typeCode] = type.items
        }
        setter({
          byType,
          isReady: true,
          isSyncing: false,
          remoteRevision: catalog.revision
        })
      } catch (error) {
        reportCaught('dict.syncRemote', error, 'warning')
        setter({
          isSyncing: false,
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
    }
  }
})

function findDictLabel(typeCode: string, value: string | null | undefined): string {
  return useDictStore.getState().findLabel(typeCode, value)
}

export { useDictStore, findDictLabel, ALL_TYPES, catalogToRemote }
