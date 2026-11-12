import { parseModels } from '@/features/agent/model/providers'
import { ensurePersist, findPref, patchPref } from '@/features/persist'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'
import { invoke } from '@tauri-apps/api/core'
import { create, type StateCreator } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

/** goose inventory providerId（历史伪 kind「goose」已过滤） */
type ProviderKind = string

interface AgentProvider {
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
  kind?: AgentProvider['kind']
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
  providers: AgentProvider[]
  providersLoaded: boolean
  activeProviderID: string | null
  /** `activeProviderID` 是用户亲手选的（true）还是系统给的默认值（false） */
  activeProviderPicked: boolean

  toReadProviders: () => Promise<AgentProvider[]>
  /** 确保快照可用后再返回（无界面的执行侧入口，见实现里的注释） */
  toEnsureProviders: () => Promise<AgentProvider[]>
  toWriteProvider: (values: AgentProvider[]) => Promise<void>
  toUpdateProvider: (values: Partial<AgentProvider>[]) => Promise<void>
  toRemoveProvider: (keys: string[]) => Promise<void>
  toSetActiveProvider: (key: string | null) => void
}

type SliceCreator<T> = StateCreator<
  ProviderSlice,
  [['zustand/devtools', never], ['zustand/subscribeWithSelector', never], ['zustand/immer', never]],
  [],
  T
>

function toProviderWrite(value: AgentProvider) {
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

/** 上次在模型选择器里点过的接入（持久化值）—— 仍存在且启用才算数 */
function findPickedProviderID(providers: readonly AgentProvider[]): string | null {
  const saved = findPref('agent').activeProviderID?.trim()
  if (!saved) return null
  const found = providers.find(function (provider) {
    return provider.id === saved && provider.enabled
  })
  return found?.id ?? null
}

/**
 * 没选过时的默认值：取**配了模型**的第一条。
 *
 * 不能直接 `providers[0]`：表是按 `updatedAt DESC` 读的，而 bootstrap 会把每条已配置
 * 接入都刷一遍时间戳，于是「最近刷新的那个空壳行」会莫名成为当前模型（连发送都会被挡）。
 */
function findDefaultProviderID(providers: readonly AgentProvider[]): string | null {
  const usable = providers.find(function (provider) {
    return provider.enabled && parseModels(provider.models).length > 0
  })
  return usable?.id ?? providers[0]?.id ?? null
}

const providerSlice: SliceCreator<ProviderSlice> = function (setters, getters) {
  return {
    providers: [],
    providersLoaded: false,
    activeProviderID: null,
    activeProviderPicked: false,

    async toReadProviders() {
      // 上次选中的接入存在持久层：没 hydrate 完就开读会拿到默认值（null），选择等于丢了
      await ensurePersist()
      try {
        const providers = (
          await invoke<AgentProvider[]>(CHANNELS.AGENT_PROVIDER.TO_READ, { params: {} })
        ).filter(function (provider) {
          return provider.kind !== 'goose'
        })
        setters(
          function (state) {
            state.providers = providers
            state.providersLoaded = true
            if (state.activeProviderID) return
            // 先认上次亲手选的那条，再退到「有模型的默认值」；前者才算显式选择
            const picked = findPickedProviderID(providers)
            state.activeProviderID = picked ?? findDefaultProviderID(providers)
            state.activeProviderPicked = picked !== null
          },
          false,
          'toReadProviders'
        )
        return providers
      } catch (error) {
        reportCaught('provider-store.toReadProviders', error)
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

    /**
     * 确保 provider 快照就绪。
     *
     * 快照目前只由「打开聊天页 / 任务面板 / 模型设置」时 hydrate，可定时任务是在后台
     * 被唤起的：应用刚启动就补跑到期任务时（catchup），列表还是空的，空列表会被
     * `prepareTarget` / `findGooseProviderID` 读成「选中的模型供应商已不存在」，
     * 于是每次到点执行都失败、手动执行却没事。执行侧先走这里，别再指望有人先开页面。
     *
     * 已加载但列表为空时也重读一次：上一次读失败同样会把 `providersLoaded` 置真。
     */
    async toEnsureProviders() {
      const state = getters()
      if (state.providersLoaded && state.providers.length > 0) return state.providers
      return getters().toReadProviders()
    },

    async toWriteProvider(values: AgentProvider[]) {
      const former = structuredClone(getters().providers)
      setters(
        function (state) {
          state.providers.push(...values)
          if (!state.activeProviderID && values[0]) {
            state.activeProviderID = values[0].id
            state.activeProviderPicked = false
          }
        },
        false,
        'toWriteProvider/optimistic'
      )

      try {
        await invoke(CHANNELS.AGENT_PROVIDER.TO_WRITE, {
          params: values.map(toProviderWrite)
        })
      } catch (error) {
        setters({ providers: former }, false, 'toWriteProvider/rollback')
        throw error
      }
    },

    async toUpdateProvider(values: Partial<AgentProvider>[]) {
      const hasID = values.every(function (v) {
        return Boolean(v.id)
      })
      if (!hasID) throw new Error('ID is required')

      const providers = structuredClone(getters().providers)
      const updatesMap = new Map<string, Partial<AgentProvider>>()
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
        await invoke(CHANNELS.AGENT_PROVIDER.TO_UPDATE, { params })
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
              state.activeProviderPicked = false
            }
          },
          false,
          'toRemoveProvider/optimistic'
        )
        await invoke(CHANNELS.AGENT_PROVIDER.TO_REMOVE, { params: keys })
      } catch (error) {
        setters({ providers: former }, false, 'toRemoveProvider/rollback')
        throw error
      }
    },

    toSetActiveProvider(key) {
      setters(
        function (state) {
          state.activeProviderID = key
          state.activeProviderPicked = key !== null
        },
        false,
        'toSetActiveProvider'
      )
      // 选择要跨重启：不落盘的话，下次启动又回到「最近更新的那一行」
      void patchPref('agent', { activeProviderID: key }).catch(function (error: unknown) {
        console.warn('[provider-store] 保存当前模型失败（不影响本轮）:', error)
      })
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
export type { AgentProvider, ProviderChange, ProviderKind, ProviderUpdate }
