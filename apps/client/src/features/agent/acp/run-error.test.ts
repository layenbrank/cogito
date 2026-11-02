import { describe, expect, it } from 'vitest'

import { RESET_ERROR_HINT, humanizeRunError, isRunCancelled } from './run-error'

function controller() {
  const abort = new AbortController()
  return abort
}

describe('isRunCancelled', () => {
  it('用户按了停止 → 算取消', () => {
    expect(isRunCancelled({ prompt: { cancelled: true } }, undefined)).toBe(true)
  })

  it('信号已 abort → 算取消', () => {
    const abort = controller()
    abort.abort()
    expect(isRunCancelled({ prompt: { cancelled: false } }, abort.signal)).toBe(true)
  })

  it('两者都没有 → 不是取消', () => {
    expect(isRunCancelled({ prompt: { cancelled: false } }, controller().signal)).toBe(false)
  })
})

describe('humanizeRunError', () => {
  it('会话被重置（Disposed）→ 换成一句能操作的中文，原始错误留在 cause', () => {
    const raw = new Error('Active session disposed')
    const error = humanizeRunError(raw, false)

    expect(error.message).toBe(RESET_ERROR_HINT)
    expect(error.cause).toBe(raw)
  })

  it('reset 标记优先：中文/本地化过的消息也能归类', () => {
    const raw = new Error('某个本地化过的错误')
    expect(humanizeRunError(raw, true).message).toBe(RESET_ERROR_HINT)
  })

  it('连接类消息（connection closed / failed to fetch / ECONNREFUSED）都归为重置', () => {
    for (const message of [
      'Connection closed',
      'Failed to fetch',
      'connect ECONNREFUSED 127.0.0.1:51562',
      'ACP 连接已 closed'
    ]) {
      expect(humanizeRunError(new Error(message), false).message).toBe(RESET_ERROR_HINT)
    }
  })

  it('真正的业务错误原样透传（不吞掉模型/网关的说法）', () => {
    const raw = new Error('组织模型调用失败')
    const error = humanizeRunError(raw, false)

    expect(error).toBe(raw)
    expect(error.message).toBe('组织模型调用失败')
  })

  it('非 Error 入参也能处理', () => {
    expect(humanizeRunError('boom', false).message).toBe('boom')
  })
})
