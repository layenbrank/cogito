import { describe, expect, it } from 'vitest'

import { toDomain, toDomainInitial, toWebSearchResults } from './web-search-state'

describe('toDomain', function () {
  it('剥协议、www.、路径与查询串', function () {
    expect(toDomain('https://www.assistant-ui.com/docs/elements?x=1')).toBe('assistant-ui.com')
    expect(toDomain('http://react.dev')).toBe('react.dev')
    expect(toDomain('https://patterns.dev/posts/draft#top')).toBe('patterns.dev')
  })

  it('去掉端口，保留主机', function () {
    expect(toDomain('localhost:5173/app')).toBe('localhost')
    expect(toDomain('http://172.16.0.31:8080/login')).toBe('172.16.0.31')
  })

  it('IPv6 的冒号不当作端口分隔', function () {
    expect(toDomain('http://[::1]:8080/x')).toBe('[::1]')
  })

  it('账号密码不进展示', function () {
    expect(toDomain('https://user:pass@example.com:8443/a')).toBe('example.com')
  })

  it('空值给空串，不抛出', function () {
    expect(toDomain('')).toBe('')
    expect(toDomain('   ')).toBe('')
  })
})

describe('toDomainInitial', function () {
  it('取域名首个字母数字并大写', function () {
    expect(toDomainInitial('assistant-ui.com')).toBe('A')
    expect(toDomainInitial('react.dev')).toBe('R')
    expect(toDomainInitial('9to5.dev')).toBe('9')
  })

  it('取不到 ASCII 时给中点，块不塌', function () {
    expect(toDomainInitial('')).toBe('·')
    expect(toDomainInitial('中文.cn')).toBe('C')
  })
})

describe('toWebSearchResults', function () {
  it('补域名并保留链接', function () {
    const rows = toWebSearchResults([
      { title: 'Persisting composer state', href: 'https://assistant-ui.com/docs/draft' }
    ])
    expect(rows).toEqual([
      {
        title: 'Persisting composer state',
        domain: 'assistant-ui.com',
        href: 'https://assistant-ui.com/docs/draft'
      }
    ])
  })

  it('没有标题时退回链接本身', function () {
    expect(toWebSearchResults([{ title: '', href: 'https://react.dev/a' }])[0].title).toBe(
      'https://react.dev/a'
    )
  })

  it('没有链接的条目直接丢掉', function () {
    expect(toWebSearchResults([{ title: 'orphan', href: '  ' }])).toEqual([])
  })

  it('按域名 + 标题去重：同一篇文章的两种地址只留一行', function () {
    const rows = toWebSearchResults([
      { title: 'Draft autosave', href: 'https://patterns.dev/draft' },
      { title: 'Draft autosave', href: 'https://patterns.dev/draft?ref=x' }
    ])
    expect(rows).toHaveLength(1)
  })

  it('同一站点不同文章各自保留', function () {
    const rows = toWebSearchResults([
      { title: 'A', href: 'https://react.dev/a' },
      { title: 'B', href: 'https://react.dev/b' }
    ])
    expect(
      rows.map(function (row) {
        return row.title
      })
    ).toEqual(['A', 'B'])
  })
})
