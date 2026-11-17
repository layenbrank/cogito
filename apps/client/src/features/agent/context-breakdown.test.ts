/**
 * 上下文分段色条：四段颜色 + 图标 + 阈值档位 + 「谁最占」排序。
 *
 * 只做纯计算与展示两件事（不碰 store、不碰消息），阈值边界见
 * `context-breakdown.test.ts`：69% 不报、70% 提醒、89% 仍是提醒、90% 告警。
 */
import { describe, expect, it } from 'vitest'

import {
  CONTEXT_SEGMENT_META,
  contextLevel,
  contextLevelOf,
  fitBreakdownToUsed,
  rankContextSegments,
  splitContextSegments,
  totalContextTokens
} from '@/features/agent/context-breakdown'

describe('上下文分段', function () {  it('四段求和等于总量，比例加起来是 1', function () {
    const usage = { systemTokens: 100, historyTokens: 300, toolTokens: 500, attachmentTokens: 100 }
    const segments = splitContextSegments(usage)
    expect(segments).toHaveLength(CONTEXT_SEGMENT_META.length)
    expect(totalContextTokens(usage)).toBe(1000)
    const sum = segments.reduce(function (acc, segment) {
      return acc + segment.tokens
    }, 0)
    expect(sum).toBe(1000)
    const ratioSum = segments.reduce(function (acc, segment) {
      return acc + segment.ratio
    }, 0)
    expect(ratioSum).toBeCloseTo(1, 10)
    expect(
      segments.find(function (segment) {
        return segment.key === 'tool'
      })?.ratio
    ).toBeCloseTo(0.5, 10)
  })

  it('空数据不除零：比例全 0、不影响渲染', function () {
    const segments = splitContextSegments({})
    expect(segments.every((segment) => segment.tokens === 0 && segment.ratio === 0)).toBe(true)
    expect(totalContextTokens(undefined)).toBe(0)
  })

  it('阈值边界：69 不报 / 70 提醒 / 89 提醒 / 90 告警', function () {
    expect(contextLevel(0.69)).toBe('ok')
    expect(contextLevel(0.7)).toBe('warn')
    expect(contextLevel(0.89)).toBe('warn')
    expect(contextLevel(0.9)).toBe('danger')
    expect(contextLevel(1)).toBe('danger')
  })

  it('窗口占用按 used/max 判定；没有 max 时不报警', function () {
    expect(contextLevelOf(69_000, 100_000)).toBe('ok')
    expect(contextLevelOf(70_000, 100_000)).toBe('warn')
    expect(contextLevelOf(90_000, 100_000)).toBe('danger')
    expect(contextLevelOf(90_000, 0)).toBe('ok')
    expect(contextLevelOf(Number.NaN, 100_000)).toBe('ok')
  })

  it('「谁最占」按 token 倒序，空段不占位', function () {
    const segments = splitContextSegments({
      systemTokens: 10,
      historyTokens: 500,
      toolTokens: 2000,
      attachmentTokens: 0
    })
    const ranked = rankContextSegments(segments)
    expect(
      ranked.map(function (segment) {
        return segment.key
      })
    ).toEqual(['tool', 'history', 'system'])
    // limit 生效
    expect(rankContextSegments(segments, 2)).toHaveLength(2)
  })

  it('四段都有独立的颜色与图标（不是同一套灰）', function () {
    const tones = new Set(
      CONTEXT_SEGMENT_META.map(function (segment) {
        return segment.tone
      })
    )
    const icons = new Set(
      CONTEXT_SEGMENT_META.map(function (segment) {
        return segment.icon
      })
    )
    expect(tones.size).toBe(CONTEXT_SEGMENT_META.length)
    expect(icons.size).toBe(CONTEXT_SEGMENT_META.length)
  })
})

/**
 * 压缩上下文之后，本地线程里的工具结果仍然在，而会话统计（`used`）已经掉下来了。
 * 直接拿估算值当分子会显示「超出 2000%」—— 折算的目标就是让四段之和恒等于 `used`。
 */
describe('按真实占用折算', function () {
  function sum(usage: ReturnType<typeof fitBreakdownToUsed>): number {
    return (
      (usage.systemTokens ?? 0) +
      (usage.historyTokens ?? 0) +
      (usage.toolTokens ?? 0) +
      (usage.attachmentTokens ?? 0)
    )
  }

  it('估算远大于真实占用时按比例压缩，和恰好等于 used', function () {
    const usage = fitBreakdownToUsed(
      { systemTokens: 3_000, historyTokens: 20_000, toolTokens: 80_000, attachmentTokens: 0 },
      5_000
    )
    expect(sum(usage)).toBe(5_000)
    // 比例保持：工具仍然是最占的那一段
    expect(usage.toolTokens).toBeGreaterThan(usage.historyTokens ?? 0)
  })

  it('估算小于真实占用时差额记到对话段（工具 schema 这类本地看不到的部分）', function () {
    const usage = fitBreakdownToUsed(
      { systemTokens: 1_000, historyTokens: 2_000, toolTokens: 0, attachmentTokens: 0 },
      10_000
    )
    expect(sum(usage)).toBe(10_000)
    expect(usage.historyTokens).toBe(9_000)
  })

  it('还没拿到统计（used <= 0）时原样返回估算值', function () {
    const estimated = { systemTokens: 10, historyTokens: 20, toolTokens: 30 }
    expect(fitBreakdownToUsed(estimated, 0)).toEqual(estimated)
  })

  it('取整误差不会让和漂移一格', function () {
    const usage = fitBreakdownToUsed(
      { systemTokens: 1, historyTokens: 1, toolTokens: 1, attachmentTokens: 1 },
      3
    )
    expect(sum(usage)).toBe(3)
  })
})
