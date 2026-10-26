import { describe, expect, it } from 'vitest'

import { buildCapabilitySummary } from '@/features/agent/model/capabilities'
import type { ActionEntry } from '@/lib/directive-ipc'

function action(overrides: Partial<ActionEntry> & Pick<ActionEntry, 'id' | 'bucket'>): ActionEntry {
  return {
    name: overrides.id,
    description: '',
    params: [],
    tags: [],
    permissions: [],
    ...overrides
  }
}

describe('corex 能力地图', function () {
  it('按 bucket 分组，列出必填参数、权限与风险', function () {
    const summary = buildCapabilitySummary([
      action({
        id: 'file.write',
        name: '文件写入',
        bucket: 'data',
        permissions: ['filesystem'],
        risk: 'medium',
        params: [
          { name: 'path', ty: 'string', required: true },
          { name: 'content', ty: 'string', required: false }
        ]
      }),
      action({ id: 'sys.lock', name: '锁定', bucket: 'system', risk: 2 })
    ])
    expect(summary.total).toBe(2)
    expect(summary.text).toContain('共 2 个')
    expect(summary.text).toContain('corex_actions')
    expect(summary.text).toContain('- file.write 文件写入（必填：path）')
    expect(summary.text).toContain('权限 filesystem')
    expect(summary.text).toContain('风险 medium')
    expect(summary.text).toContain('风险 2')
    // system 排在 data 前
    expect(summary.text.indexOf('### system')).toBeLessThan(summary.text.indexOf('### data'))
  })

  it('空目录返回空文本', function () {
    expect(buildCapabilitySummary([])).toEqual({ text: '', total: 0, shown: 0 })
  })

  it('超出预算时截断并提示调用 corex_actions', function () {
    const actions = Array.from({ length: 30 }, function (_, index) {
      return action({
        id: `data.item.${index}`,
        name: `动作 ${index}`,
        bucket: 'data',
        params: [{ name: 'veryLongParameterName', ty: 'string', required: true }]
      })
    })
    const summary = buildCapabilitySummary(actions, { maxChars: 500, maxPerBucket: 30 })
    expect(summary.shown).toBeLessThan(30)
    expect(summary.text).toContain('按预算截断')
  })
})
