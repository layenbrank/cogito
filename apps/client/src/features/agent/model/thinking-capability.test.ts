import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearThinkingCapability,
  findThinkingCapability,
  recordThinkingApplied,
  recordThinkingCapability,
  subscribeThinkingCapability
} from './thinking-capability'

beforeEach(function () {
  clearThinkingCapability()
})

describe('thinking-capability', function () {
  it('会话给出选项后才算「知道」：之前是 null', function () {
    expect(findThinkingCapability('p::m')).toBeNull()
    recordThinkingCapability('p::m', ['None', 'Low', 'High'])
    expect(findThinkingCapability('p::m')?.values).toEqual(['none', 'low', 'high'])
  })

  it('同一份选项重复写入不触发订阅（流式里每轮都会调）', function () {
    recordThinkingCapability('p::m', ['off', 'low'])
    const listener = vi.fn()
    const unsubscribe = subscribeThinkingCapability(listener)
    recordThinkingCapability('p::m', ['off', 'low'])
    expect(listener).not.toHaveBeenCalled()

    recordThinkingCapability('p::m', ['off', 'low', 'high'])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('回执独立于选项：选项没变也能只更新 applied', function () {
    recordThinkingCapability('p::m', ['low', 'high'])
    recordThinkingApplied('p::m', 'HIGH')
    expect(findThinkingCapability('p::m')).toEqual({
      values: ['low', 'high'],
      applied: 'high',
      scope: 'session'
    })
  })

  it('会话没给选项时只写全局键：scope 记成 global，UI 才能说「新会话生效」', function () {
    recordThinkingApplied('p::m', 'medium', 'global')
    expect(findThinkingCapability('p::m')).toEqual({
      values: [],
      applied: 'medium',
      scope: 'global'
    })
  })

  it('选项变化不清掉已有回执（避免每轮建会话都把「实际下发」抹掉）', function () {
    recordThinkingCapability('p::m', ['low', 'high'])
    recordThinkingApplied('p::m', 'high')
    recordThinkingCapability('p::m', ['low'])
    expect(findThinkingCapability('p::m')).toEqual({
      values: ['low'],
      applied: 'high',
      scope: 'session'
    })
  })

  it('按模型 key 分开存，换模型不串味', function () {
    recordThinkingCapability('a::m1', ['low'])
    recordThinkingCapability('b::m2', ['high'])
    expect(findThinkingCapability('a::m1')?.values).toEqual(['low'])
    expect(findThinkingCapability('b::m2')?.values).toEqual(['high'])
  })
})
