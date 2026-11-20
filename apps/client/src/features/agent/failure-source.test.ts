import { describe, expect, it } from 'vitest'

import { buildToolFailureReport, classifyToolFailure, describeToolFailure } from './failure-source'

describe('classifyToolFailure', () => {
  it('连接中断优先于工具字样', () => {
    for (const output of [
      'Active session disposed',
      'Connection closed',
      'connect ECONNREFUSED 127.0.0.1:51562',
      'goose 未就绪（/health 的 goose 字段可查状态）'
    ]) {
      expect(classifyToolFailure(output)).toBe('connection')
    }
  })

  it('授权拒绝', () => {
    expect(classifyToolFailure('The tool is not allowed by policy (never_allow)')).toBe('permission')
    expect(classifyToolFailure('用户拒绝了这次调用')).toBe('permission')
  })

  it('模型 / 网关错误不会被当成工具错误', () => {
    expect(classifyToolFailure('provider 未配置')).toBe('model')
    expect(classifyToolFailure('Upstream 429 rate limit exceeded')).toBe('model')
    expect(classifyToolFailure('context window exceeded')).toBe('model')
  })

  it('工具自身报错（文件系统错误码不算授权拒绝）', () => {
    expect(classifyToolFailure('EACCES: permission denied, open D:/x')).toBe('tool')
    expect(classifyToolFailure('tool execution failed: ENOENT')).toBe('tool')
    expect(classifyToolFailure('参数不合法：path 缺失')).toBe('tool')
  })

  it('认不出来就说不知道', () => {
    expect(classifyToolFailure('')).toBe('unknown')
    expect(classifyToolFailure('某种本地化过的说法')).toBe('unknown')
  })
})

describe('describeToolFailure', () => {
  it('每一类都有可读标签与下一步', () => {
    for (const source of ['permission', 'connection', 'model', 'tool', 'unknown'] as const) {
      const copy = describeToolFailure(source)
      expect(copy.label.length).toBeGreaterThan(0)
      expect(copy.hint.length).toBeGreaterThan(0)
    }
  })
})

describe('buildToolFailureReport', () => {
  it('带归因、调用 id 与原始参数，便于贴回重跑', () => {
    const report = JSON.parse(
      buildToolFailureReport({
        toolName: 'cogito_terminal_run',
        toolCallId: 'tc_1',
        output: 'connect ECONNREFUSED 127.0.0.1:51562',
        args: { command: 'pnpm test' }
      })
    ) as Record<string, unknown>

    expect(report.toolName).toBe('cogito_terminal_run')
    expect(report.toolCallId).toBe('tc_1')
    expect(report.source).toBe('connection')
    expect(report.args).toEqual({ command: 'pnpm test' })
    expect(typeof report.at).toBe('string')
  })
})
