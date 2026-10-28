import { describe, expect, it } from 'vitest'

import { findStatusBadge, groupEntries } from './git-status.ts'

function entry(path: string, indexStatus: string, worktreeStatus: string) {
  return { path, indexStatus, worktreeStatus }
}

describe('groupEntries', function () {
  it('未跟踪单独归组', function () {
    const groups = groupEntries([entry('a.ts', '?', '?')])
    expect(groups.untracked).toHaveLength(1)
    expect(groups.staged).toHaveLength(0)
    expect(groups.changed).toHaveLength(0)
  })

  it('只有暂存改动时归入暂存组', function () {
    const groups = groupEntries([entry('a.ts', 'M', ' ')])
    expect(groups.staged).toHaveLength(1)
    expect(groups.changed).toHaveLength(0)
  })

  it('只有工作区改动时归入更改组', function () {
    const groups = groupEntries([entry('a.ts', ' ', 'M')])
    expect(groups.staged).toHaveLength(0)
    expect(groups.changed).toHaveLength(1)
  })

  it('暂存后又改动会同时出现在两组', function () {
    const groups = groupEntries([entry('a.ts', 'M', 'M')])
    expect(groups.staged).toHaveLength(1)
    expect(groups.changed).toHaveLength(1)
  })

  it('忽略项被过滤', function () {
    const groups = groupEntries([entry('dist/a.js', '!', '!')])
    expect(groups.staged).toHaveLength(0)
    expect(groups.changed).toHaveLength(0)
    expect(groups.untracked).toHaveLength(0)
  })
})

describe('findStatusBadge', function () {
  it('暂存状态优先展示', function () {
    expect(findStatusBadge(entry('a.ts', 'A', 'M'))).toBe('A')
  })

  it('未识别字符兜底为问号', function () {
    expect(findStatusBadge(entry('a.ts', ' ', ' '))).toBe('?')
  })
})
