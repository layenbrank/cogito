import { describe, expect, it } from 'vitest'

import { lintWikiPages, parseWikilinks } from '@/views/knowledge/lib/wiki-lint.ts'

describe('parseWikilinks', function () {
  it('提取标题与别名语法中的目标', function () {
    expect(parseWikilinks('见 [[Alpha]] 与 [[Beta|β]]')).toEqual(['Alpha', 'Beta'])
  })
})

describe('lintWikiPages', function () {
  it('报告断链与孤儿', function () {
    const issues = lintWikiPages([
      {
        relative: 'wiki/a.md',
        title: 'A',
        content: '链接 [[Missing]]'
      },
      {
        relative: 'wiki/b.md',
        title: 'B',
        content: '无链'
      }
    ])
    expect(issues.some(function (issue) {
      return issue.kind === 'broken-link'
    })).toBe(true)
    expect(issues.some(function (issue) {
      return issue.kind === 'orphan'
    })).toBe(true)
    expect(issues.some(function (issue) {
      return issue.kind === 'missing-index'
    })).toBe(true)
  })
})
