import { describe, expect, it } from 'vitest'

import { matchesFilter, parseQuery } from '@/features/command-bar/query'

describe('command-bar query', function () {
  it('parses domain prefixes', function () {
    expect(parseQuery('nav:github')).toEqual({
      filter: 'navigation',
      text: 'github',
      raw: 'nav:github'
    })
    expect(parseQuery('cal: 周会')).toEqual({
      filter: 'calendar',
      text: '周会',
      raw: 'cal: 周会'
    })
    expect(parseQuery('web:rust')).toEqual({
      filter: 'web',
      text: 'rust',
      raw: 'web:rust'
    })
  })

  it('keeps chip filter when no prefix', function () {
    expect(parseQuery('hello', 'agent')).toEqual({
      filter: 'agent',
      text: 'hello',
      raw: 'hello'
    })
  })

  it('matches tile filter to collection', function () {
    expect(matchesFilter('collection', 'tile')).toBe(true)
    expect(matchesFilter('navigation', 'tile')).toBe(false)
    expect(matchesFilter('agent', 'all')).toBe(true)
  })
})
