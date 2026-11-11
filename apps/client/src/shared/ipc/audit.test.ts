import { describe, expect, it } from 'vitest'

import {
  AuditExportSchema,
  describeAudit,
  type AuditExport
} from './audit'

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    exportedAt: 1_700_000_000_000,
    retentionMs: 7 * 24 * 60 * 60 * 1000,
    limit: 2000,
    total: 2,
    entries: [
      {
        id: 'a',
        toolName: 'app_workspace_write',
        effect: 'write',
        risk: 'guarded',
        ok: true,
        error: null,
        argsDigest: 'fnv1a64:0123456789abcdef',
        durationMs: 12,
        createdAt: 1_700_000_000_000
      },
      {
        id: 'b',
        toolName: 'app_nope',
        effect: 'unknown',
        risk: 'unknown',
        ok: false,
        error: '未知工具：app_nope',
        argsDigest: 'fnv1a64:ffffffffffffffff',
        durationMs: 0,
        createdAt: 1_699_999_999_000
      }
    ],
    ...overrides
  }
}

describe('工具审计回包契约（S6）', () => {
  it('接受 Rust 侧的真实形状', function () {
    const parsed = AuditExportSchema.parse(payload())
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries[1].ok).toBe(false)
    expect(parsed.exportedAt).toBe(1_700_000_000_000)
  })

  it('拒绝未知的 effect / risk 档位', function () {
    const bad = payload()
    const entries = bad.entries as Array<Record<string, unknown>>
    entries[0].effect = 'execute'
    expect(AuditExportSchema.safeParse(bad).success).toBe(false)
  })

  it('即使上游多给了 args 原文也不会进前端对象', function () {
    const withArgs = payload()
    const entries = withArgs.entries as Array<Record<string, unknown>>
    entries[0].arguments = { content: '机密' }
    const parsed = AuditExportSchema.parse(withArgs)
    expect(Object.keys(parsed.entries[0])).not.toContain('arguments')
  })

  it('摘要串说明条数、失败数与保留天数', function () {
    const parsed = AuditExportSchema.parse(payload())
    expect(describeAudit(parsed)).toBe('2 条 · 其中失败 1 条 · 保留 7 天')
  })

  it('被 limit 截断时按「显示 / 总数」呈现', function () {
    const parsed: AuditExport = AuditExportSchema.parse(payload({ total: 99, limit: 2 }))
    expect(describeAudit(parsed)).toBe('2 / 99 条 · 其中失败 1 条 · 保留 7 天')
  })
})
