/**
 * 「本轮实际发出的系统提示」登记表。
 *
 * 上下文估算原先自己推导系统提示，与真实发送侧（`port/model.ts` 的 `buildSystemPrompt`
 * 加场景覆盖 / 端口覆盖）不一致 —— 表现为「系统」那一格与真实上下文对不上。
 * 这里只存最近一次发送的原文，估算直接读它。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearSentSystemText,
  forgetSentSystemText,
  readSentSystemText,
  rememberSentSystemText,
  subscribeSentSystemText
} from '@/features/agent/sent-system-text'

afterEach(function () {
  clearSentSystemText()
})

describe('sent-system-text', function () {
  it('没发过时返回 null（调用方回退到推导值）', function () {
    expect(readSentSystemText('t1')).toBeNull()
  })

  it('登记后能读到，且带空白的 threadID 归一', function () {
    rememberSentSystemText(' t1 ', 'sys')
    expect(readSentSystemText('t1')).toBe('sys')
    expect(readSentSystemText(' t1 ')).toBe('sys')
  })

  it('空字符串也是一份登记（那一轮确实没带系统提示）', function () {
    rememberSentSystemText('t1', 'sys')
    rememberSentSystemText('t1', '')
    expect(readSentSystemText('t1')).toBe('')
  })

  it('内容不变时不通知（避免估算每条消息都重算）', function () {
    const listener = vi.fn()
    const stop = subscribeSentSystemText(listener)
    rememberSentSystemText('t1', 'sys')
    rememberSentSystemText('t1', 'sys')
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('解绑 / 清空时读者拿到 null', function () {
    rememberSentSystemText('t1', 'sys')
    forgetSentSystemText('t1')
    expect(readSentSystemText('t1')).toBeNull()

    rememberSentSystemText('t2', 'sys')
    clearSentSystemText()
    expect(readSentSystemText('t2')).toBeNull()
  })

  it('登记表有上限：一次性线程（内联 / 子代理）不会把它撑爆', function () {
    for (let index = 0; index < 260; index += 1) {
      rememberSentSystemText(`t-${index}`, 'sys')
    }
    // 最早的被淘汰
    expect(readSentSystemText('t-0')).toBeNull()
    expect(readSentSystemText('t-259')).toBe('sys')
  })
})
