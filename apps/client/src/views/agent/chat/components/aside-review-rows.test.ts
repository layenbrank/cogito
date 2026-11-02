import { describe, expect, it } from 'vitest'

import { splitReviewRows } from '@/views/agent/chat/components/aside-review-rows'

function entry(path: string, indexStatus: string, worktreeStatus: string) {
  return { path, indexStatus, worktreeStatus }
}

describe('审阅分段（(path, side) 行身份）', function () {
  it('index / worktree 两侧都有改动时各出现一行，不做跨侧去重', function () {
    const rows = splitReviewRows([entry('src/a.ts', 'M', 'M')])
    expect(rows.staged.map((item) => item.path)).toEqual(['src/a.ts'])
    expect(rows.changed.map((item) => item.path)).toEqual(['src/a.ts'])
    expect(rows.untracked).toHaveLength(0)
  })

  it('只暂存放 staged，只改工作区放 changed', function () {
    const rows = splitReviewRows([
      entry('src/staged.ts', 'M', ' '),
      entry('src/changed.ts', ' ', 'M')
    ])
    expect(rows.staged.map((item) => item.path)).toEqual(['src/staged.ts'])
    expect(rows.changed.map((item) => item.path)).toEqual(['src/changed.ts'])
  })

  it('未跟踪与新增文件分开：?? 进 untracked，A 进 staged', function () {
    const rows = splitReviewRows([
      entry('src/new-added.ts', 'A', ' '),
      entry('src/new-untracked.ts', '?', '?')
    ])
    expect(rows.staged.map((item) => item.path)).toEqual(['src/new-added.ts'])
    expect(rows.untracked.map((item) => item.path)).toEqual(['src/new-untracked.ts'])
    expect(rows.changed).toHaveLength(0)
  })

  it('忽略项（!!）不进入任何分段', function () {
    const rows = splitReviewRows([entry('dist/bundle.js', '!', '!')])
    expect(rows.staged).toHaveLength(0)
    expect(rows.changed).toHaveLength(0)
    expect(rows.untracked).toHaveLength(0)
  })

  it('段内保持 git status 的原始顺序', function () {
    const rows = splitReviewRows([
      entry('a.ts', 'M', ' '),
      entry('b.ts', 'M', ' '),
      entry('c.ts', 'M', ' ')
    ])
    expect(rows.staged.map((item) => item.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })
})
