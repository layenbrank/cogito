import { describe, expect, it } from 'vitest'

import { buildMatcher, buildPattern, isValidQuery } from './search-query.ts'

const literal = {
  query: 'foo.bar',
  isRegex: false,
  isCaseSensitive: false,
  isWholeWord: false
}

describe('buildPattern', function () {
  it('普通模式转义正则元字符', function () {
    expect(buildPattern(literal)).toBe('foo\\.bar')
  })

  it('正则模式保留表达式本身', function () {
    expect(buildPattern({ ...literal, query: 'foo\\d+', isRegex: true })).toBe('foo\\d+')
  })

  it('全字匹配包一层词边界', function () {
    expect(buildPattern({ ...literal, query: 'run', isWholeWord: true })).toBe('\\brun\\b')
  })
})

describe('buildMatcher', function () {
  it('默认忽略大小写', function () {
    const matcher = buildMatcher({ ...literal, query: 'Foo' })
    expect(matcher?.flags).toBe('gi')
  })

  it('区分大小写时去掉 i', function () {
    const matcher = buildMatcher({ ...literal, query: 'Foo', isCaseSensitive: true })
    expect(matcher?.flags).toBe('g')
  })

  it('内容为空返回 null', function () {
    expect(buildMatcher({ ...literal, query: '   ' })).toBeNull()
  })

  it('表达式非法返回 null', function () {
    expect(buildMatcher({ ...literal, query: '(', isRegex: true })).toBeNull()
  })
})

describe('isValidQuery', function () {
  it('空输入视为有效（不提示错误）', function () {
    expect(isValidQuery({ ...literal, query: '' })).toBe(true)
  })

  it('非法正则判定为无效', function () {
    expect(isValidQuery({ ...literal, query: '[a-', isRegex: true })).toBe(false)
  })
})
