import { describe, expect, it } from 'vitest'

import { findUsageTotals, formatTokens } from '@/features/agent/model/usage.ts'

type Usage = MagneticTile.Agent.Usage

function usage(patch: Partial<Usage>): Usage {
  return {
    id: 'id',
    runID: 'run',
    sessionID: 'session',
    providerID: null,
    model: 'deepseek-chat',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    createdAt: 0,
    ...patch
  }
}

describe('findUsageTotals', function () {
  it('逐条相加，条数即运行轮次', function () {
    const totals = findUsageTotals([
      usage({ inputTokens: 100, outputTokens: 20, totalTokens: 120 }),
      usage({ inputTokens: 1, outputTokens: 2, totalTokens: 3 })
    ])
    expect(totals).toEqual({ runs: 2, inputTokens: 101, outputTokens: 22, totalTokens: 123 })
  })

  it('空列表给全 0（不返回 null）', function () {
    expect(findUsageTotals([])).toEqual({ runs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  })
})

describe('formatTokens', function () {
  it('千分位，脏数据按 0', function () {
    expect(formatTokens(12345)).toBe('12,345')
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(-5)).toBe('0')
    expect(formatTokens(Number.NaN)).toBe('0')
  })
})
