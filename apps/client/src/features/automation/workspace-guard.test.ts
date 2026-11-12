import { describe, expect, it } from 'vitest'

import {
  findOutsidePaths,
  isSamePath,
  isWithin,
  resolvePath
} from '@/features/automation/workspace-guard'

const ROOT = 'C:\\work\\proj-a'

describe('isWithin / isSamePath', function () {
  it('目录本身与子路径算在内，前缀相同的兄弟目录不算', function () {
    expect(isWithin(ROOT, 'C:\\work\\proj-a')).toBe(true)
    expect(isWithin(ROOT, 'C:\\work\\proj-a\\src\\a.ts')).toBe(true)
    // 只是名字前缀相同：proj-a2 不是 proj-a 的子目录
    expect(isWithin(ROOT, 'C:\\work\\proj-a2\\a.ts')).toBe(false)
    // 上一级
    expect(isWithin(ROOT, 'C:\\work\\proj-a\\..\\other\\b.txt')).toBe(false)
  })

  it('大小写与分隔符不影响判断', function () {
    expect(isWithin(ROOT, 'c:/WORK/Proj-A/src/a.ts')).toBe(true)
    expect(isSamePath(ROOT, 'C:/work/proj-a/')).toBe(true)
    expect(isSamePath(ROOT, 'C:/work/proj-b')).toBe(false)
  })

  it('相对路径按 root 展开', function () {
    expect(resolvePath(ROOT, 'src/a.ts')).toBe('C:\\work\\proj-a/src/a.ts')
    expect(resolvePath(ROOT, '../b.txt')).toBe('C:\\work\\proj-a/../b.txt')
    expect(isWithin(ROOT, resolvePath(ROOT, '../b.txt'))).toBe(false)
  })
})

describe('findOutsidePaths', function () {
  it('没有工作目录时不拦人', function () {
    expect(findOutsidePaths(null, { path: 'C:\\anywhere\\a.txt' })).toEqual([])
    expect(findOutsidePaths('  ', { path: 'C:\\anywhere\\a.txt' })).toEqual([])
  })

  it('目录内的路径放行，外面的一条条报出来', function () {
    const input = { path: 'C:\\work\\proj-a\\report.txt', content: 'hello' }
    expect(findOutsidePaths(ROOT, input)).toEqual([])

    const bad = {
      path: 'C:\\work\\proj-b\\report.txt',
      nested: { file_path: 'C:\\Users\\iwell\\Desktop\\x.txt' }
    }
    expect(findOutsidePaths(ROOT, bad)).toEqual([
      'C:\\work\\proj-b\\report.txt',
      'C:\\Users\\iwell\\Desktop\\x.txt'
    ])
  })

  it('相对路径按任务目录展开；~ 开头一律算越界', function () {
    expect(findOutsidePaths(ROOT, { path: 'src/a.ts' })).toEqual([])
    expect(findOutsidePaths(ROOT, { path: '../sibling/a.ts' })).toEqual(['../sibling/a.ts'])
    expect(findOutsidePaths(ROOT, { path: '~/notes/a.md' })).toEqual(['~/notes/a.md'])
  })

  it('非路径参数与 URL 不会被误判', function () {
    const input = {
      command: 'npm test',
      content: 'C:\\other\\file.txt',
      url: 'https://example.com/a'
    }
    expect(findOutsidePaths(ROOT, input)).toEqual([])
  })

  it('ACP 的 locations 也要算进去', function () {
    const locations = [{ path: 'C:\\work\\proj-a\\a.ts' }, { path: 'C:\\work\\elsewhere\\b.ts' }]
    expect(findOutsidePaths(ROOT, {}, locations)).toEqual(['C:\\work\\elsewhere\\b.ts'])
  })
})
