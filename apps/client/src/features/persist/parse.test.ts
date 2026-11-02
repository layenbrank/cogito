import { describe, expect, it } from 'vitest'

import { parseNamespace } from '@/features/persist/parse'

describe('agent 偏好解析', function () {
  it('旧存档缺 activeRootByWorkspace 时回落空映射', function () {
    const parsed = parseNamespace('agent', { approvalMode: 'auto' })
    expect(parsed.activeRootByWorkspace).toEqual({})
    expect(parsed.approvalMode).toBe('auto')
  })

  it('只收非空字符串，脏值丢弃', function () {
    const parsed = parseNamespace('agent', {
      activeRootByWorkspace: {
        'ws-1': '/repo/frontend',
        'ws-2': '   ',
        'ws-3': 42,
        '': '/repo/x'
      }
    })
    expect(parsed.activeRootByWorkspace).toEqual({ 'ws-1': '/repo/frontend' })
  })

  it('整块不是对象时回落空映射', function () {
    expect(parseNamespace('agent', { activeRootByWorkspace: 'nope' }).activeRootByWorkspace).toEqual(
      {}
    )
    expect(parseNamespace('agent', null).activeRootByWorkspace).toEqual({})
  })
})
