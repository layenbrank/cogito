import { describe, expect, it } from 'vitest'

import {
  RESET_ERROR_HINT,
  annotateRunFailure,
  humanizeRunError,
  isRunCancelled
} from './run-error'

function controller() {
  const abort = new AbortController()
  return abort
}

describe('isRunCancelled', function () {
  it('用户按了停止 → 算取消', function () {
    expect(isRunCancelled({ prompt: { cancelled: true } }, undefined)).toBe(true)
  })

  it('信号已 abort → 算取消', function () {
    const abort = controller()
    abort.abort()
    expect(isRunCancelled({ prompt: { cancelled: false } }, abort.signal)).toBe(true)
  })

  it('两者都没有 → 不是取消', function () {
    expect(isRunCancelled({ prompt: { cancelled: false } }, controller().signal)).toBe(false)
  })
})

describe('humanizeRunError', function () {
  it('会话被重置（Disposed）→ 换成一句能操作的中文，原始错误留在 cause', function () {
    const raw = new Error('Active session disposed')
    const error = humanizeRunError(raw, false)

    expect(error.message).toBe(RESET_ERROR_HINT)
    expect(error.cause).toBe(raw)
  })

  it('reset 标记优先：中文/本地化过的消息也能归类', function () {
    const raw = new Error('某个本地化过的错误')
    expect(humanizeRunError(raw, true).message).toBe(RESET_ERROR_HINT)
  })

  it('连接类消息（connection closed / failed to fetch / ECONNREFUSED）都归为重置', function () {
    for (const message of [
      'Connection closed',
      'Failed to fetch',
      'connect ECONNREFUSED 127.0.0.1:51562',
      'ACP 连接已 closed'
    ]) {
      expect(humanizeRunError(new Error(message), false).message).toBe(RESET_ERROR_HINT)
    }
  })

  it('真正的业务错误原样透传（不吞掉模型/网关的说法）', function () {
    const raw = new Error('组织模型调用失败')
    const error = humanizeRunError(raw, false)

    expect(error).toBe(raw)
    expect(error.message).toBe('组织模型调用失败')
  })

  it('非 Error 入参也能处理', function () {
    expect(humanizeRunError('boom', false).message).toBe('boom')
  })
})

describe('annotateRunFailure', function () {
  it('模型 / 网关失败带上归因，用户才知道不是工具坏了', function () {
    expect(annotateRunFailure('Upstream 429 rate limit exceeded', 'provider')).toBe(
      '模型 / 网关：Upstream 429 rate limit exceeded'
    )
  })

  it('工具失败指向那张工具卡', function () {
    expect(annotateRunFailure('tool execution failed: ENOENT', 'tool')).toBe(
      '工具执行：tool execution failed: ENOENT'
    )
  })

  it('归因缺失 / 认不出来就原样透传（不猜）', function () {
    expect(annotateRunFailure('某种没见过的失败', undefined)).toBe('某种没见过的失败')
    expect(annotateRunFailure('某种没见过的失败', 'weird')).toBe('某种没见过的失败')
    expect(annotateRunFailure('某种没见过的失败', 'unknown')).toBe('某种没见过的失败')
  })

  it('只有归因、没有消息时给一句能操作的说明', function () {
    expect(annotateRunFailure('', 'connection')).toContain('连接中断：与 goose 的连接断了')
    expect(annotateRunFailure('   ', undefined)).toBe('这一轮失败了')
  })
})
