import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', function () {
  return { invoke }
})

import {
  degradeRoute,
  isLocalKind,
  isRouteTier,
  markRouteTier,
  noteRunFailure,
  pickProvider,
  planRoute,
  readRouteTier
} from '@/features/agent/model/route'

const providers = [
  { id: 'p-cloud', kind: 'openai', enabled: true },
  { id: 'p-local', kind: 'ollama', enabled: true },
  { id: 'p-off', kind: 'ollama', enabled: false }
]

describe('分层路由（S11）', function () {
  beforeEach(function () {
    invoke.mockReset()
    markRouteTier('local')
  })

  it('本地 provider 的 kind 只认白名单', function () {
    expect(isLocalKind('ollama')).toBe(true)
    expect(isLocalKind(' OLLAMA ')).toBe(true)
    expect(isLocalKind('atomic')).toBe(true)
    expect(isLocalKind('openai')).toBe(false)
  })

  it('档位字面量只认 local / cloud', function () {
    expect(isRouteTier('local')).toBe(true)
    expect(isRouteTier('cloud')).toBe(true)
    expect(isRouteTier('edge')).toBe(false)
    expect(isRouteTier(undefined)).toBe(false)
  })

  it('显式选中的接入优先，档位不参与', function () {
    // 选云端就发云端：本机装着 Ollama 也不能把 DeepSeek 换掉
    const cloudPicked = pickProvider({ providers, activeProviderID: 'p-cloud', tier: 'local' })
    expect(cloudPicked?.id).toBe('p-cloud')
    const localPicked = pickProvider({ providers, activeProviderID: 'p-local', tier: 'cloud' })
    expect(localPicked?.id).toBe('p-local')
  })

  it('没选过时才按档位挑：本地优先，云档位取第一条启用的', function () {
    const local = pickProvider({ providers, activeProviderID: null, tier: 'local' })
    expect(local?.id).toBe('p-local')
    const cloud = pickProvider({ providers, activeProviderID: null, tier: 'cloud' })
    expect(cloud?.id).toBe('p-cloud')
  })

  it('没有本地 provider / 选中项已停用时回落档位默认值', function () {
    const onlyCloud = pickProvider({
      providers: [{ id: 'p-cloud', kind: 'openai', enabled: true }],
      activeProviderID: null,
      tier: 'local'
    })
    expect(onlyCloud?.id).toBe('p-cloud')
    const picked = pickProvider({ providers, activeProviderID: 'p-off', tier: 'cloud' })
    expect(picked?.id).toBe('p-cloud')
  })

  it('规划：本地不可用时给出降级结论', async function () {
    invoke.mockResolvedValueOnce({
      plan: { tier: 'cloud', fallback: null, degraded: true, reason: 'Ollama 未运行' },
      localModels: [],
      probe: 'Ollama 未运行'
    })
    const reply = await planRoute('local', 'qwen3:14b')
    expect(invoke).toHaveBeenCalledWith('agentRoute:plan', {
      params: { tier: 'local', model: 'qwen3:14b' }
    })
    expect(reply?.plan.degraded).toBe(true)
  })

  it('规划失败或返回不可识别时按「不降级」处理', async function () {
    invoke.mockRejectedValueOnce(new Error('ipc down'))
    await expect(planRoute('local', null)).resolves.toBeNull()
    invoke.mockResolvedValueOnce({ plan: { tier: 'edge' } })
    await expect(planRoute('local', null)).resolves.toBeNull()
  })

  it('降级判定：可判定失败换云，用户取消不换', async function () {
    invoke.mockResolvedValueOnce({ next: 'cloud', failure: 'connectRefused' })
    await expect(degradeRoute('local', 'Connection refused')).resolves.toBe('cloud')
    invoke.mockResolvedValueOnce({ next: null, failure: 'userCancel' })
    await expect(degradeRoute('local', '操作已取消')).resolves.toBeNull()
  })

  it('降级判定调用失败时不开新路', async function () {
    invoke.mockRejectedValueOnce(new Error('boom'))
    await expect(degradeRoute('local', 'Connection refused')).resolves.toBeNull()
  })

  it('本轮可判定失败后档位切到云并落库', async function () {
    invoke.mockResolvedValueOnce({ next: 'cloud', failure: 'modelMissing' })
    invoke.mockResolvedValueOnce('cloud')
    const next = await noteRunFailure({
      from: 'local',
      message: 'model not found: qwen3',
      sessionID: 's1'
    })
    expect(next).toBe('cloud')
    expect(readRouteTier()).toBe('cloud')
    expect(invoke).toHaveBeenLastCalledWith('agentRoute:setTier', {
      params: { sessionId: 's1', tier: 'cloud' }
    })
  })

  it('用户取消时不动档位、不落库', async function () {
    invoke.mockResolvedValueOnce({ next: null, failure: 'userCancel' })
    const next = await noteRunFailure({ from: 'local', message: '操作已取消' })
    expect(next).toBeNull()
    expect(readRouteTier()).toBe('local')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('档位落库失败不影响本轮', async function () {
    invoke.mockRejectedValueOnce(new Error('db locked'))
    markRouteTier('cloud', 's1')
    expect(readRouteTier()).toBe('cloud')
    markRouteTier('local')
  })
})
