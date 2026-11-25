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

  it('报告规范问题：缺 type / type 与目录不符 / 未进 index', function () {
    const pages = [
      {
        relative: 'wiki/index.md',
        title: 'Index',
        content: '# Index\n\n- [[Alpha]]\n'
      },
      {
        relative: 'wiki/concepts/alpha.md',
        title: 'Alpha',
        content: '---\ntype: concept\ntitle: Alpha\n---\n\n正文 [[Index]]'
      },
      {
        relative: 'wiki/beta.md',
        title: 'Beta',
        content: '---\ntype: concept\ntitle: Beta\n---\n\n正文 [[Alpha]]'
      },
      {
        relative: 'wiki/gamma.md',
        title: 'Gamma',
        content: '没有 frontmatter，[[Alpha]]'
      }
    ]
    const issues = lintWikiPages(pages)
    const kindsOf = function (page: string) {
      return issues
        .filter(function (issue) {
          return issue.page === page
        })
        .map(function (issue) {
          return issue.kind
        })
    }

    expect(kindsOf('wiki/concepts/alpha.md')).not.toContain('missing-type')
    expect(kindsOf('wiki/concepts/alpha.md')).not.toContain('type-dir-mismatch')
    expect(kindsOf('wiki/concepts/alpha.md')).not.toContain('not-in-index')

    expect(kindsOf('wiki/beta.md')).toContain('type-dir-mismatch')
    expect(kindsOf('wiki/beta.md')).toContain('not-in-index')
    expect(kindsOf('wiki/gamma.md')).toContain('missing-type')
  })
})
