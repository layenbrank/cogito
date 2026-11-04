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

describe('code 工作区解析', function () {
  it('只有旧 workspaceRoot 时回落成单根', function () {
    const parsed = parseNamespace('tiles', { code: { workspaceRoot: 'C:/repo' } })
    expect(parsed.code.workspaceRoots).toEqual(['C:/repo'])
    expect(parsed.code.workspaceRoot).toBe('C:/repo')
  })

  it('workspaceRoots 过滤空串 / 重复 / 尾分隔符，主根取第一个', function () {
    const parsed = parseNamespace('tiles', {
      code: {
        workspaceRoots: ['C:/a/', 'C:\\a', '   ', 42, 'C:/b', 'C:/b/']
      }
    })
    expect(parsed.code.workspaceRoots).toEqual(['C:/a/', 'C:/b'])
    expect(parsed.code.workspaceRoot).toBe('C:/a/')
  })

  it('workspaceID 非字符串或空白时置 null', function () {
    expect(parseNamespace('tiles', { code: { workspaceID: ' ws-1 ' } }).code.workspaceID).toBe(
      ' ws-1 '
    )
    expect(parseNamespace('tiles', { code: { workspaceID: '   ' } }).code.workspaceID).toBeNull()
    expect(parseNamespace('tiles', { code: { workspaceID: 7 } }).code.workspaceID).toBeNull()
  })

  it('recentRoots 上限 10、recentPaths 上限 20', function () {
    const roots = Array.from({ length: 14 }, function (_, index) {
      return `/repo/${index}`
    })
    const paths = Array.from({ length: 26 }, function (_, index) {
      return `/repo/f${index}.ts`
    })
    const parsed = parseNamespace('tiles', { code: { recentRoots: roots, recentPaths: paths } })
    expect(parsed.code.recentRoots).toHaveLength(10)
    expect(parsed.code.recentPaths).toHaveLength(20)
    expect(parsed.code.recentRoots[0]).toBe('/repo/0')
  })

  it('新编辑器字段越界收敛、枚举未知回落默认', function () {
    const parsed = parseNamespace('tiles', {
      code: {
        editorWordWrap: 'bogus',
        editorWordWrapColumn: 999,
        editorRenderWhitespace: 'bogus',
        editorTabSize: 1,
        isEditorMinimapEnabled: 'yes'
      }
    })
    expect(parsed.code.editorWordWrap).toBe('off')
    expect(parsed.code.editorWordWrapColumn).toBe(200)
    expect(parsed.code.editorRenderWhitespace).toBe('selection')
    expect(parsed.code.editorTabSize).toBe(2)
    expect(parsed.code.isEditorMinimapEnabled).toBe(true)
  })

  it('新编辑器字段合法值原样保留', function () {
    const parsed = parseNamespace('tiles', {
      code: {
        editorWordWrap: 'bounded',
        editorWordWrapColumn: 88,
        editorRenderWhitespace: 'all',
        editorTabSize: 4,
        isEditorSemanticHighlightingEnabled: false
      }
    })
    expect(parsed.code.editorWordWrap).toBe('bounded')
    expect(parsed.code.editorWordWrapColumn).toBe(88)
    expect(parsed.code.editorRenderWhitespace).toBe('all')
    expect(parsed.code.editorTabSize).toBe(4)
    expect(parsed.code.isEditorSemanticHighlightingEnabled).toBe(false)
  })
})

describe('诊断偏好解析', function () {
  it('默认开启崩溃上报', function () {
    expect(parseNamespace('diagnostics', null).reportCrashes).toBe(true)
    expect(parseNamespace('diagnostics', {}).reportCrashes).toBe(true)
  })

  it('关掉后保持关闭，脏值回落默认', function () {
    expect(parseNamespace('diagnostics', { reportCrashes: false }).reportCrashes).toBe(false)
    expect(parseNamespace('diagnostics', { reportCrashes: 'no' }).reportCrashes).toBe(true)
  })
})
