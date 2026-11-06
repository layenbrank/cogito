/**
 * 工具行摘要的取值口径：一列 `read` 长得一模一样是折叠行最大的可读性问题。
 * 这里的用例锁三件事 —— 「优先级」「单行化 / 裁剪」「取不到就不编」。
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_MAX_LENGTH, toolCallSummary } from './tool-call-summary'

describe('工具实参摘要', function () {
  it('路径优先：读文件行给的是路径，不是同级的其它字段', function () {
    expect(
      toolCallSummary({ path: 'apps/client/src/main.tsx', limit: 200 })
    ).toBe('apps/client/src/main.tsx')
  })

  it('命令压成单行：多行 heredoc 也不能把折叠行撑成两行', function () {
    expect(toolCallSummary({ command: 'pnpm build\n  --filter client\n' })).toBe(
      'pnpm build --filter client'
    )
  })

  it('按候选顺序取第一个命中的键', function () {
    // path 排在 command 之前
    expect(toolCallSummary({ command: 'rm -rf x', path: 'a.ts' })).toBe('a.ts')
  })

  it('字符串数组拼成一行（多文件同一行的说明）', function () {
    expect(toolCallSummary({ path: ['a.ts', 'b.ts'] })).toBe('a.ts b.ts')
  })

  it('超长裁剪并加省略号，长度不超过上限', function () {
    const long = 'x'.repeat(200)
    const summary = toolCallSummary({ prompt: long }) ?? ''
    expect(summary.length).toBe(DEFAULT_MAX_LENGTH)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('取不到就不编：不是对象 / 没候选键 / 空串都返回 undefined', function () {
    expect(toolCallSummary(undefined)).toBeUndefined()
    expect(toolCallSummary('raw string')).toBeUndefined()
    expect(toolCallSummary([{ path: 'a.ts' }])).toBeUndefined()
    expect(toolCallSummary({ unknownKey: 'whatever' })).toBeUndefined()
    expect(toolCallSummary({ path: '   ' })).toBeUndefined()
    expect(toolCallSummary({ path: 42 })).toBeUndefined()
  })
})
