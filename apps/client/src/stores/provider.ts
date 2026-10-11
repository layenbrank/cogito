import { invoke } from '@tauri-apps/api/core'
import { create, type StateCreator } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { CHANNELS } from '@/shared/ipc/channels'

/** goose inventory providerId（历史伪 kind「goose」已过滤） */
type ProviderKind = string

interface AiProvider {
  id: string
  /** 与 goose providerId 对齐；通常 id === kind */
  kind: ProviderKind
  name: string
  baseUrl: string | null
  /** JSON 序列化的可选模型列表 */
  models: string | null
  /** 默认选中模型 */
  model: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
}

interface ProviderChange {
  kind?: AiProvider['kind']
  name?: string
  baseUrl?: string | null
  models?: string | null
  model?: string | null
  enabled?: boolean
}

interface ProviderUpdate {
  key: string
  change: ProviderChange
}

interface ProviderSlice {
  providers: AiProvider[]
  providersLoaded: boolean
  activeProviderID: string | null

  toReadProviders(): Promise<AiProvider[]>
  toWriteProvider(values: AiProvider[]): Promise<void>
  toUpdateProvider(values: Partial<AiProvider>[]): Promise<void>
  toRemoveProvider(keys: string[]): Promise<void>
  toSetActiveProvider(key: string | null): void
}

type SliceCreator<T> = StateCreator<
  ProviderSlice,
  [['zustand/devtools', never], ['zustand/subscribeWithSelector', never], ['zustand/immer', never]],
  [],
  T
>

function toProviderWrite(value: AiProvider) {
  return {
    id: value.id,
    kind: value.kind,
    name: value.name,
    baseUrl: value.baseUrl,
    models: value.models,
    model: value.model,
    enabled: value.enabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

const providerSlice: SliceCreator<ProviderSlice> = function (setters, getters) {
  return {
    providers: [],
    providersLoaded: false,
    activeProviderID: null,

    async toReadProviders() {
      try {
        const providers = (await invoke<AiProvider[]>(CHANNELS.AI_PROVIDER.TO_READ, { params: {} })).filter(
          function (provider) {
            return provider.kind !== 'goose'
          }
        )
        setters(
          function (state) {
            state.providers = providers
            state.providersLoaded = true
            if (!state.activeProviderID && providers[0]) {
              state.activeProviderID = providers[0].id
            }
          },
          false,
          'toReadProviders'
        )
        return providers
      } catch (error) {
        console.error('[provider-store] toReadProviders failed:', error)
        setters(
          function (state) {
            state.providersLoaded = true
          },
          false,
          'toReadProviders/error'
        )
        return []
      }
    },

    async toWriteProvider(values: AiProvider[]) {
      const former = structuredClone(getters().providers)
      setters(
        function (state) {
          state.providers.push(...values)
          if (!state.activeProviderID && values[0]) {
            state.activeProviderID = values[0].id
          }
        },
        false,
        'toWriteProvider/optimistic'
      )

      try {
        await invoke(CHANNELS.AI_PROVIDER.TO_WRITE, {
          params: values.map(toProviderWrite)
        })
      } catch (error) {
        setters({ providers: former }, false, 'toWriteProvider/rollback')
        throw error
      }
    },

    async toUpdateProvider(values: Partial<AiProvider>[]) {
      const hasID = values.every(function (v) {
        return Boolean(v.id)
      })
      if (!hasID) throw new Error('ID is required')

      const providers = structuredClone(getters().providers)
      const updatesMap = new Map<string, Partial<AiProvider>>()
      values.forEach(function (v) {
        if (v.id) updatesMap.set(v.id, v)
      })

      setters(
        function (state) {
          state.providers = state.providers.map(function (item) {
            const update = updatesMap.get(item.id)
            if (!update) return item
            return Object.assign({}, item, update)
          })
        },
        false,
        'toUpdateProvider/optimistic'
      )

      try {
        const params: ProviderUpdate[] = values.map(function (v) {
          const { id, ...change } = v
          return { key: id!, change }
        })
        await invoke(CHANNELS.AI_PROVIDER.TO_UPDATE, { params })
      } catch (error) {
        setters({ providers }, false, 'toUpdateProvider/rollback')
        throw error
      }
    },

    async toRemoveProvider(keys: string[]) {
      const former = structuredClone(getters().providers)
      try {
        setters(
          function (state) {
            const keySet = new Set(keys)
            state.providers = former.filter(function (provider) {
              return !keySet.has(provider.id)
            })
            if (state.activeProviderID && keySet.has(state.activeProviderID)) {
              state.activeProviderID = state.providers[0]?.id ?? null
            }
          },
          false,
          'toRemoveProvider/optimistic'
        )
        await invoke(CHANNELS.AI_PROVIDER.TO_REMOVE, { params: keys })
      } catch (error) {
        setters({ providers: former }, false, 'toRemoveProvider/rollback')
        throw error
      }
    },

    toSetActiveProvider(key) {
      setters(
        function (state) {
          state.activeProviderID = key
        },
        false,
        'toSetActiveProvider'
      )
    }
  }
}

const useProviderStore = create<ProviderSlice>()(
  devtools(
    subscribeWithSelector(
      immer(function (...args) {
        return {
          ...providerSlice(...args)
        }
      })
    ),
    {
      name: 'ProviderStore',
      enabled: import.meta.env.DEV
    }
  )
)

export { useProviderStore }
export type { AiProvider, ProviderChange, ProviderKind, ProviderUpdate }
