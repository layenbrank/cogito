import { describe, expect, it } from 'vitest'

import {
  findOwningRoot,
  resolveWorkspacePicks,
  splitFolderScope,
  toAgentPath,
  toAgentReference
} from '@/features/agent/workspace/paths'
import {
  buildFolderLabels,
  findFolderLabel,
  findParentRelative
} from '@/views/agent/chat/components/workspace-relative-path'

const ROOT = 'C:/repo/frontend'
const OTHER = 'C:/repo/backend'

describe('引用路径（toAgentPath / toAgentReference）', function () {
  it('主文件夹内压成相对路径', function () {
    expect(toAgentPath('C:/repo/frontend/src/main.ts', ROOT)).toBe('src/main.ts')
  })

  it('其他文件夹给绝对路径：相对路径在那儿解析不了', function () {
    expect(toAgentPath('C:/repo/backend/src/api.ts', ROOT)).toBe('C:/repo/backend/src/api.ts')
  })

  it('根自身走绝对路径', function () {
    expect(toAgentPath(ROOT, ROOT)).toBe(ROOT)
  })

  it('「根 + 根内相对路径」也能折算（右栏面板就是这种入参）', function () {
    expect(toAgentReference(ROOT, 'src/main.ts', ROOT)).toBe('src/main.ts')
    expect(toAgentReference(OTHER, 'src/api.ts', ROOT)).toBe('C:/repo/backend/src/api.ts')
  })

  it('反斜杠路径与大小写前缀同样能识别归属', function () {
    expect(toAgentPath('c:\\repo\\frontend\\src\\main.ts', ROOT)).toBe('src/main.ts')
  })
})

describe('文件夹归属（findOwningRoot）', function () {
  it('取最长前缀命中，避免父子文件夹搞混', function () {
    const roots = ['C:/repo', 'C:/repo/apps/web']
    expect(findOwningRoot('C:/repo/apps/web/src/a.ts', roots)).toBe('C:/repo/apps/web')
    expect(findOwningRoot('C:/repo/apps/api/src/a.ts', roots)).toBe('C:/repo')
  })

  it('不在任何文件夹内返回 null', function () {
    expect(findOwningRoot('D:/elsewhere/a.ts', [ROOT, OTHER])).toBeNull()
  })
})

describe('多根拾取（resolveWorkspacePicks）', function () {
  it('其他文件夹里的路径不再被当成「不在工作区内」', function () {
    const picks = resolveWorkspacePicks(
      ['C:/repo/frontend/src/a.ts', 'C:/repo/backend/src/b.ts', 'D:/tmp/c.ts'],
      [ROOT, OTHER],
      ROOT
    )
    expect(picks.references).toEqual(['src/a.ts', 'C:/repo/backend/src/b.ts'])
    expect(picks.skipped).toEqual(['c.ts'])
  })
})

describe('@ 查询收窄（splitFolderScope）', function () {
  it('命中文件夹名时只搜这个文件夹', function () {
    expect(splitFolderScope([ROOT, OTHER], 'backend/src')).toEqual({
      root: OTHER,
      query: 'src'
    })
    expect(splitFolderScope([ROOT, OTHER], 'backend')).toEqual({ root: OTHER, query: '' })
  })

  it('同名文件夹按传入顺序命中（调用方把当前文件夹排在前面）', function () {
    const first = 'C:/a/api'
    const second = 'C:/b/api'
    expect(splitFolderScope([second, first], 'api/x')).toEqual({ root: second, query: 'x' })
  })

  it('不是文件夹名时默认不收窄', function () {
    expect(splitFolderScope([ROOT, OTHER], 'src/main')).toBeNull()
  })
})

describe('文件夹展示名（buildFolderLabels）', function () {
  it('不重名时用末段名', function () {
    const labels = buildFolderLabels([ROOT, OTHER])
    expect(findFolderLabel(labels, ROOT)).toBe('frontend')
    expect(findFolderLabel(labels, OTHER)).toBe('backend')
  })

  it('重名时补上一级目录，两个 api 才分得清', function () {
    const roots = ['C:/repo/apps/api', 'C:/repo/services/api']
    const labels = buildFolderLabels(roots)
    expect(findFolderLabel(labels, roots[0])).toBe('apps/api')
    expect(findFolderLabel(labels, roots[1])).toBe('services/api')
  })

  it('未知路径回落到末段名', function () {
    expect(findFolderLabel(new Map(), 'C:/repo/docs')).toBe('docs')
  })
})

describe('相对路径工具', function () {
  it('父目录与末段名兼容反斜杠', function () {
    expect(findParentRelative('src\\components\\a.tsx')).toBe('src/components')
    expect(findParentRelative('a.tsx')).toBe('')
  })
})
