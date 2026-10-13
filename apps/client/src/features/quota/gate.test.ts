import { describe, expect, it } from 'vitest'

import { GATEWAY_PROVIDER_KIND, buildBlocker, isGatewayTarget } from '@/features/quota/gate.ts'
import type { GatewaySelfQuota } from '@/apis/gateway.ts'

describe('isGatewayTarget', function () {
  it('认 cogito_gateway（与 Rust PROVIDER_ID 一致）', function () {
    expect(GATEWAY_PROVIDER_KIND).toBe('cogito_gateway')
    expect(isGatewayTarget('cogito_gateway')).toBe(true)
  })

  it('旧别名 cogito / 其它 kind 不走网关门', function () {
    expect(isGatewayTarget('cogito')).toBe(false)
    expect(isGatewayTarget('openai')).toBe(false)
    expect(isGatewayTarget(undefined)).toBe(false)
  })
})

describe('buildBlocker', function () {
  it('exhausted 时给出可读文案', function () {
    const quota = {
      exhausted: true,
      used: 1000,
      limit: 1000,
      remaining: 0
    } as GatewaySelfQuota
    expect(buildBlocker(quota)).toMatch(/今日额度已用尽/)
  })

  it('未触顶放行', function () {
    const quota = {
      exhausted: false,
      used: 10,
      limit: 1000,
      remaining: 990
    } as GatewaySelfQuota
    expect(buildBlocker(quota)).toBeNull()
  })
})
