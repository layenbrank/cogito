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
  rankContextSegments,
  splitContextSegments,
  totalContextTokens
} from '@/features/agent/context-breakdown'

describe('上下文分段', function () {
  it('四段求和等于总量，比例加起来是 1', function () {
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
