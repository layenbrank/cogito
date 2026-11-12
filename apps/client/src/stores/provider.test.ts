import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * provider 快照的 hydrate 口径。
 *
 * 定时任务在后台被唤起，没有任何页面先挂载；`toEnsureProviders` 就是给这类
 * 「无界面执行侧」用的入口 —— 空列表不能再被当成「供应商已不存在」。
 */
const invoke = vi.fn<(channel: string, params?: unknown) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', function () {
  return {
    invoke: function (channel: string, params?: unknown) {
      return invoke(channel, params)
    }
  }
})

vi.mock('@/features/persist', function () {
  return {
    ensurePersist: function () {
      return Promise.resolve()
    },
    findPref: function () {
      return {}
    },
    patchPref: function () {
      return Promise.resolve()
    }
  }
})

import { CHANNELS } from '@/shared/ipc/channels'
import { useProviderStore, type AgentProvider } from '@/stores/provider'

function makeProvider(id: string): AgentProvider {
  return {
    id,
    kind: id,
    name: id,
    baseUrl: null,
    models: null,
    model: null,
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}

function reset(state: { providers?: AgentProvider[]; providersLoaded?: boolean }): void {
  useProviderStore.setState({
    providers: state.providers ?? [],
    providersLoaded: state.providersLoaded ?? false,
    activeProviderID: null,
    activeProviderPicked: false
  })
}

describe('toEnsureProviders', function () {
  beforeEach(function () {
    invoke.mockReset()
    reset({})
  })

  it('没 hydrate 过时自己读一次，返回读到的接入', async function () {
    invoke.mockResolvedValue([makeProvider('custom_deepseek')])

    const providers = await useProviderStore.getState().toEnsureProviders()

    expect(providers.map((item) => item.id)).toEqual(['custom_deepseek'])
    expect(invoke).toHaveBeenCalledWith(CHANNELS.AGENT_PROVIDER.TO_READ, { params: {} })
    expect(useProviderStore.getState().providersLoaded).toBe(true)
  })

  it('已有快照时不再打 IPC（避免每次执行都重读）', async function () {
    reset({ providers: [makeProvider('custom_deepseek')], providersLoaded: true })

    const providers = await useProviderStore.getState().toEnsureProviders()

    expect(providers.map((item) => item.id)).toEqual(['custom_deepseek'])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('上次读失败留下的「已加载但空列表」要重读', async function () {
    reset({ providers: [], providersLoaded: true })
    invoke.mockResolvedValue([makeProvider('custom_deepseek')])

    const providers = await useProviderStore.getState().toEnsureProviders()

    expect(providers.map((item) => item.id)).toEqual(['custom_deepseek'])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('真的没有任何接入时如实返回空列表，不抛错', async function () {
    invoke.mockResolvedValue([])

    await expect(useProviderStore.getState().toEnsureProviders()).resolves.toEqual([])
  })
})
