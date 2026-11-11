import { describe, expect, it } from 'vitest'

import { CostExportSchema, describeCost, formatMicros } from '@/shared/ipc/cost'

function raw(patch: Record<string, unknown> = {}) {
  return {
    exportedAt: 1_760_000_000_000,
    retentionMs: 400 * 24 * 60 * 60 * 1000,
    limit: 5000,
    total: 2,
    currency: 'CNY',
    totals: {
      runs: 2,
      inputTokens: 1500,
      outputTokens: 500,
      priceMicros: 2_500_000,
      pricedRuns: 1,
      unpricedRuns: 1
    },
    entries: [
      {
        id: 'c1',
        usageId: 'u1',
        runId: 'r1',
        sessionId: 's1',
        model: 'deepseek-chat',
        inputTokens: 1000,
        outputTokens: 500,
        priceMicros: 2_500_000,
        currency: 'CNY',
        dayKey: '2026-11-10',
        createdAt: 1_760_000_000_000
      },
      {
        id: 'c2',
        usageId: 'u2',
        runId: null,
        sessionId: null,
        model: 'mystery-model',
        inputTokens: 500,
        outputTokens: 0,
        priceMicros: null,
        currency: null,
        dayKey: '2026-11-10',
        createdAt: 1_760_000_001_000
      }
    ],
    ...patch
  }
}

describe('成本账本契约', function () {
  it('收下 Rust 侧真实形状，未计价保持 null', function () {
    const parsed = CostExportSchema.parse(raw())
    expect(parsed.entries[1].priceMicros).toBeNull()
    expect(parsed.entries[1].currency).toBeNull()
    expect(parsed.totals.unpricedRuns).toBe(1)
  })

  it('上游多给的字段不会落进解析结果', function () {
    const parsed = CostExportSchema.parse(
      raw({
        entries: [
          {
            ...raw().entries[0],
            prompt: '不许带正文',
            content: '不许带正文'
          }
        ]
      })
    )
    expect(Object.keys(parsed.entries[0])).not.toContain('prompt')
    expect(Object.keys(parsed.entries[0])).not.toContain('content')
  })

  it('必填字段缺失就报错，不静默补 0', function () {
    const broken = raw() as Record<string, unknown>
    delete broken.totals
    expect(function () {
      CostExportSchema.parse(broken)
    }).toThrow()
  })
})

describe('describeCost', function () {
  it('说清条数、金额与未计价条数', function () {
    const parsed = CostExportSchema.parse(raw())
    expect(describeCost(parsed)).toBe('2 条 · 合计 ¥2.50 · 1 条未计价')
  })

  it('被 limit 截断时显示「已取 / 总数」', function () {
    const parsed = CostExportSchema.parse(raw({ total: 99 }))
    expect(describeCost(parsed)).toBe('2 / 99 条 · 合计 ¥2.50 · 1 条未计价')
  })

  it('全部计价时不提未计价', function () {
    const parsed = CostExportSchema.parse(
      raw({
        totals: {
          runs: 1,
          inputTokens: 1000,
          outputTokens: 500,
          priceMicros: 2_500_000,
          pricedRuns: 1,
          unpricedRuns: 0
        }
      })
    )
    expect(describeCost(parsed)).toBe('2 条 · 合计 ¥2.50')
  })
})

describe('formatMicros', function () {
  it('微元换算成两位小数', function () {
    expect(formatMicros(0)).toBe('¥0.00')
    expect(formatMicros(2_500_000)).toBe('¥2.50')
    expect(formatMicros(1_234_567)).toBe('¥1.23')
  })

  it('负数与脏数据按 0，不显示成 -0.00', function () {
    expect(formatMicros(-5_000_000)).toBe('¥0.00')
    expect(formatMicros(Number.NaN)).toBe('¥0.00')
  })

  it('币种不认识就带代码，不冒充人民币', function () {
    expect(formatMicros(1_000_000, 'USD')).toBe('$1.00')
    expect(formatMicros(1_000_000, 'EUR')).toBe('EUR 1.00')
  })
})
