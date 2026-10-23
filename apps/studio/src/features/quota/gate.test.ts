import { GATEWAY_PROVIDER_KIND } from '@cogito/agent/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GatewaySelfQuota } from '@/apis/gateway.ts'
import {
  buildBlocker,
  clearQuotaCheck,
  findSendBlocker,
  isGatewayTarget
} from './gate.ts'

/**
 * 拦截判定全部来自服务端那一个只读接口：客户端不再读模型目录、也不再翻页汇总用量。
 * 原则仍是「算不准就放行」—— 接口失败、解析不出一律交给服务端。
 */

const deps = vi.hoisted(function () {
  return {
    getQuota: vi.fn(),
    syncActiveTenant: vi.fn(),
    /** 平台凭据；`findSendBlocker` 会在问配额之前先看它 */
    token: 'jwt' as string | null
  }
})

vi.mock('@/apis/gateway.ts', function () {
  return { GET_GATEWAY_QUOTA_ME: deps.getQuota }
})

vi.mock('@/features/quota/tenant.ts', function () {
  return { syncActiveTenant: deps.syncActiveTenant }
})

vi.mock('@/utils/auth.ts', function () {
  return {
    findAuthToken: function () {
      return deps.token
    }
  }
})

function selfQuota(partial: Partial<GatewaySelfQuota> = {}): GatewaySelfQuota {
  return {
    scope: 'TENANT',
    scopeID: 't1',
    tenantID: 't1',
    tenantType: 'PERSONAL',
    source: 'FREE',
    limit: 1000,
    used: 0,
    remaining: 1000,
    exhausted: false,
    resetsAt: Date.UTC(2024, 4, 10),
    ...partial
  }
}

beforeEach(function () {
  vi.clearAllMocks()
  clearQuotaCheck()
  vi.spyOn(console, 'warn').mockImplementation(function () {
    return undefined
  })
  // 平台地址与令牌是闸门的前置条件：这里给全，好让下面的用例专心量配额那一段
  vi.stubEnv('VITE_COGITO', 'http://127.0.0.1:3000/api/v1')
  deps.token = 'jwt'
  deps.syncActiveTenant.mockResolvedValue('t1')
  deps.getQuota.mockResolvedValue(selfQuota())
})

describe('isGatewayTarget', function () {
  it('only accepts the gateway provider kind', function () {
    expect(isGatewayTarget(GATEWAY_PROVIDER_KIND)).toBe(true)
    expect(isGatewayTarget('openai')).toBe(false)
    expect(isGatewayTarget(undefined)).toBe(false)
  })
})

describe('buildBlocker', function () {
  it('stays quiet below the limit', function () {
    expect(buildBlocker(selfQuota({ used: 999, remaining: 1 }))).toBeNull()
  })

  it('explains the block once the server reports the quota used up', function () {
    const blocker = buildBlocker(selfQuota({ used: 1000, remaining: 0, exhausted: true }))

    expect(blocker).toContain('1000 / 1000')
    expect(blocker).toContain('UTC')
    expect(blocker).toContain('设置 → 额度')
  })

  it('trusts the server flag instead of recomputing used against limit', function () {
    const blocker = buildBlocker(selfQuota({ used: 10, remaining: 990, exhausted: true }))

    expect(blocker).toContain('10 / 1000')
  })

  it('scales large numbers the same way the settings card does', function () {
    const blocker = buildBlocker(
      selfQuota({
        source: 'PLAN',
        plan: 'pro',
        limit: 1_000_000,
        used: 1_000_000,
        remaining: 0,
        exhausted: true
      })
    )

    expect(blocker).toContain('100.0 万 / 100.0 万')
  })
})

describe('findSendBlocker', function () {
  it('never gates non-gateway providers', async function () {
    await expect(findSendBlocker({ isGateway: false, modelID: 'gpt' })).resolves.toBeNull()
    expect(deps.syncActiveTenant).not.toHaveBeenCalled()
  })

  it('asks for a login instead of letting the host answer «登录已过期»', async function () {
    deps.token = null

    const blocker = await findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })

    expect(blocker).toContain('登录')
    // 平台模型没凭据必然失败，连配额都不用问
    expect(deps.getQuota).not.toHaveBeenCalled()
  })

  it('clears the login blocker as soon as a token is back', async function () {
    deps.token = null
    await expect(findSendBlocker({ isGateway: true, modelID: 'gpt' })).resolves.toContain('登录')

    deps.token = 'jwt'
    await expect(findSendBlocker({ isGateway: true, modelID: 'gpt' })).resolves.toBeNull()
  })

  it('asks for the model level quota when the target has a model', async function () {
    await findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })

    expect(deps.getQuota).toHaveBeenCalledWith({ model: 'gpt-4o-mini' })
  })

  it('asks for the identity level quota when it does not', async function () {
    await findSendBlocker({ isGateway: true, modelID: null })

    expect(deps.getQuota).toHaveBeenCalledWith({})
  })

  it('blocks as soon as the gateway says the window is used up', async function () {
    deps.getQuota.mockResolvedValue(selfQuota({ used: 1000, remaining: 0, exhausted: true }))

    await expect(findSendBlocker({ isGateway: true, modelID: 'gpt' })).resolves.toContain(
      '1000 / 1000'
    )
  })

  it('still blocks without a tenant identity, because the account has its own quota', async function () {
    deps.syncActiveTenant.mockResolvedValue(null)
    deps.getQuota.mockResolvedValue(
      selfQuota({
        scope: 'USER',
        scopeID: 'u1',
        tenantID: undefined,
        used: 1000,
        remaining: 0,
        exhausted: true
      })
    )

    await expect(findSendBlocker({ isGateway: true, modelID: 'gpt' })).resolves.toContain(
      '1000 / 1000'
    )
  })

  it('re-checks when the billing identity changes', async function () {
    await findSendBlocker({ isGateway: true, modelID: 'gpt' })

    deps.syncActiveTenant.mockResolvedValue('t2')
    await findSendBlocker({ isGateway: true, modelID: 'gpt' })

    expect(deps.getQuota).toHaveBeenCalledTimes(2)
  })

  it('caches the verdict for the same tenant and model', async function () {
    await findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })
    await findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })

    expect(deps.getQuota).toHaveBeenCalledTimes(1)

    await findSendBlocker({ isGateway: true, modelID: 'other-model' })
    expect(deps.getQuota).toHaveBeenCalledTimes(2)
  })

  it('re-checks after the cache is cleared, so a new subscription applies at once', async function () {
    deps.getQuota.mockResolvedValue(selfQuota({ used: 10, remaining: 0, exhausted: true }))
    await expect(findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })).resolves.toContain(
      '10 / 1000'
    )

    deps.getQuota.mockResolvedValue(selfQuota({ limit: 10_000, remaining: 10_000 }))
    clearQuotaCheck()

    await expect(findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })).resolves.toBeNull()
  })

  it('re-checks once the ttl is over', async function () {
    vi.useFakeTimers()
    await findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })

    vi.advanceTimersByTime(61_000)
    await findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })

    expect(deps.getQuota).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('lets the request through when the lookup fails, and says so', async function () {
    deps.getQuota.mockRejectedValue(new Error('offline'))

    await expect(findSendBlocker({ isGateway: true, modelID: 'gpt' })).resolves.toBeNull()
    expect(console.warn).toHaveBeenCalled()
  })

  it('remembers a failed check instead of retrying it for every message', async function () {
    deps.getQuota.mockRejectedValue(new Error('offline'))

    await findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })
    await findSendBlocker({ isGateway: true, modelID: 'gpt-4o-mini' })

    expect(deps.getQuota).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })
})
