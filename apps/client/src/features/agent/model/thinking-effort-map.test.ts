import { describe, expect, it } from 'vitest'

import { isThinkingLevel, resolveThinkingValue, THINKING_CANDIDATES } from './thinking-effort-map'

describe('resolveThinkingValue', function () {
  it('不知道可用值时不查表：直接下发 goose 全局键的五档', function () {
    expect(resolveThinkingValue('medium', null)).toEqual({
      value: 'medium',
      matched: true,
      degraded: false
    })
    expect(resolveThinkingValue('off', [])).toEqual({
      value: 'off',
      matched: true,
      degraded: false
    })
  })

  it('goose 五档齐全时一一对应，不算降级', function () {
    const available = ['off', 'low', 'medium', 'high', 'max']
    expect(resolveThinkingValue('high', available)).toEqual({
      value: 'high',
      matched: true,
      degraded: false
    })
  })

  it('DeepSeek 只有 none/low/high/max：标准落到 high 且要报降级', function () {
    const available = ['none', 'low', 'high', 'max']
    expect(resolveThinkingValue('medium', available)).toEqual({
      value: 'high',
      matched: true,
      degraded: true
    })
    // 关闭必须真的关：落到 none，而不是「不发参数」
    expect(resolveThinkingValue('off', available)).toEqual({
      value: 'none',
      matched: true,
      degraded: true
    })
  })

  it('大小写与空白不影响命中', function () {
    expect(resolveThinkingValue('max', [' LOW ', 'High', 'MAX '])).toEqual({
      value: 'max',
      matched: true,
      degraded: false
    })
  })

  it('一个都不沾时不硬塞：matched=false，交回 goose 兜底', function () {
    expect(resolveThinkingValue('low', ['auto', 'turbo'])).toEqual({
      value: 'low',
      matched: false,
      degraded: true
    })
  })

  it('每档的候选值都包含自身，badge 不会出现「标准 → 标准」被误判降级', function () {
    for (const level of Object.keys(THINKING_CANDIDATES) as Array<
      keyof typeof THINKING_CANDIDATES
    >) {
      expect(THINKING_CANDIDATES[level][0]).toBe(level)
    }
  })
})

describe('isThinkingLevel', function () {
  it('只认五档', function () {
    expect(isThinkingLevel('off')).toBe(true)
    expect(isThinkingLevel('max')).toBe(true)
    expect(isThinkingLevel('xhigh')).toBe(false)
    expect(isThinkingLevel('')).toBe(false)
  })
})
