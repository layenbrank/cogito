import { describe, expect, it } from 'vitest'

import {
  buildFolderLabels,
  completePathSegment,
  findFolderLabel
} from './workspace-relative-path.ts'

describe('completePathSegment', function () {
  it('推进到下一层目录', function () {
    expect(completePathSegment('apps/client/src/a.ts', 'apps/cli', false)).toBe('apps/client/')
  })

  it('已经是完整文件路径时返回 null，交给调用方落 chip', function () {
    expect(completePathSegment('apps/client/src/a.ts', 'apps/client/src/a.ts', false)).toBeNull()
  })

  it('目录补完带尾斜杠，可以继续往里打', function () {
    expect(completePathSegment('apps/client', 'apps/cli', true)).toBe('apps/client/')
    expect(completePathSegment('apps/client', 'apps/client/', true)).toBeNull()
  })

  it('命中中间片段时补到那一层末尾', function () {
    expect(completePathSegment('apps/client/src/button.tsx', 'butt', false)).toBe(
      'apps/client/src/button.tsx'
    )
  })

  it('空 query 直接给整条路径', function () {
    expect(completePathSegment('client', '', true)).toBe('client/')
    expect(completePathSegment('client/src/a.ts', '', false)).toBe('client/src/a.ts')
  })

  it('反斜杠与 ./ 前缀按路径语义归一', function () {
    expect(completePathSegment('apps/client/src', './apps\\cli', true)).toBe('apps/client/')
  })
})

describe('buildFolderLabels', function () {
  it('重名文件夹补上一级目录', function () {
    const labels = buildFolderLabels(['C:/work/apps/api', 'C:/work/services/api', 'C:/work/web'])
    expect(findFolderLabel(labels, 'C:/work/apps/api')).toBe('apps/api')
    expect(findFolderLabel(labels, 'C:/work/services/api')).toBe('services/api')
    expect(findFolderLabel(labels, 'C:/work/web')).toBe('web')
  })
})
