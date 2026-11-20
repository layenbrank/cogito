import { describe, expect, it } from 'vitest'

import { classifyRunFailure, toErrorExcerpt } from './error-kind'

describe('classifyRunFailure', () => {
  it('用户取消不算失败', () => {
    expect(classifyRunFailure('run aborted')).toBe('cancelled')
    expect(classifyRunFailure('用户已停止这一轮')).toBe('cancelled')
  })

  it('连接 / 侧车问题', () => {
    for (const message of [
      'Active session disposed',
      'Connection closed',
      'connect ECONNREFUSED 127.0.0.1:51562',
      'goose 未就绪（/health 的 goose 字段可查状态）',
      'ACP session/prompt 超时'
    ]) {
      expect(classifyRunFailure(message)).toBe('connection')
    }
  })

  it('授权拒绝', () => {
    expect(classifyRunFailure('tool is not allowed by policy (never_allow)')).toBe('permission')
    expect(classifyRunFailure('用户拒绝了这次工具调用')).toBe('permission')
  })

  it('模型 / 网关错误优先于「tool」字样', () => {
    expect(classifyRunFailure('provider 未配置')).toBe('provider')
    expect(classifyRunFailure('model claude-x not found')).toBe('provider')
    expect(classifyRunFailure('Upstream 429 rate limit exceeded')).toBe('provider')
    expect(classifyRunFailure('context length exceeded')).toBe('provider')
  })

  it('工具层错误', () => {
    expect(classifyRunFailure('tool execution failed: ENOTDIR')).toBe('tool')
  })

  it('认不出来就说不知道', () => {
    expect(classifyRunFailure('')).toBe('unknown')
    expect(classifyRunFailure(undefined)).toBe('unknown')
    expect(classifyRunFailure('某种本地化过的说法')).toBe('unknown')
  })
})

describe('toErrorExcerpt', () => {
  it('压成一行并限制长度', () => {
    expect(toErrorExcerpt('第一行\n第二行')).toBe('第一行 第二行')
    const long = 'x'.repeat(600)
    const excerpt = toErrorExcerpt(long) ?? ''
    expect(excerpt.length).toBe(501)
    expect(excerpt.endsWith('…')).toBe(true)
  })

  it('空消息不产出空串', () => {
    expect(toErrorExcerpt('   ')).toBeUndefined()
  })
})
