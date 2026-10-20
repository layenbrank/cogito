import { describe, expect, it } from 'vitest'

import { ENGINES } from '@/constants/engine'
import { ENGINE_UI } from '@/views/browser/engine/engine-constants'
import {
  buildSuggestionUrl,
  findAddressUrl,
  findDefaultNavigation,
  findItemUrl,
  isUrlKeyword,
  parseKeywordUrl,
  parseSuggestionLabel
} from '@/views/browser/engine/engine-url'

describe('engine url', function () {
  it('strips private-use marks from suggestion labels', function () {
    expect(parseSuggestionLabel('hello \uE000windows\uE001')).toBe('hello windows')
  })

  it('treats a bare host as a url and a sentence as a query', function () {
    expect(isUrlKeyword('example.com')).toBe(true)
    expect(isUrlKeyword('hello world')).toBe(false)
    expect(parseKeywordUrl('example.com/a')).toBe('https://example.com/a')
  })

  it('joins a suggestion path onto the engine origin', function () {
    expect(buildSuggestionUrl('https://cn.bing.com', '/search?q=rust')).toBe(
      'https://cn.bing.com/search?q=rust'
    )
  })

  it('opens bing suggestion paths, and other engines as a search', function () {
    const bing = ENGINES[0]
    const baidu = ENGINES[1]
    const item = { q: 'hello \uE000', u: '/search?q=hello' }
    expect(findItemUrl(bing, item)).toBe('https://cn.bing.com/search?q=hello')
    expect(findItemUrl(baidu, item)).toBe('https://www.baidu.com/s?wd=hello%20')
  })

  it('searches when the text is not a host', function () {
    expect(findAddressUrl('测试', ENGINES[0].match)).toBe(
      'https://cn.bing.com/search?q=%E6%B5%8B%E8%AF%95'
    )
    expect(findAddressUrl('a b&c', ENGINES[0].match)).toBe(
      'https://cn.bing.com/search?q=a%20b%26c'
    )
    expect(findAddressUrl('example.com/a', ENGINES[0].match)).toBe('https://example.com/a')
  })

  it('opens ip addresses and searches an incomplete number', function () {
    expect(findAddressUrl('127.0.0.1', ENGINES[0].match)).toBe('https://127.0.0.1')
    expect(findAddressUrl('http://8.8.8.8:53/dns', ENGINES[0].match)).toBe('http://8.8.8.8:53/dns')
    expect(findAddressUrl('[::1]', ENGINES[0].match)).toBe('https://[::1]')
    expect(findAddressUrl('999.1.1.1', ENGINES[0].match)).toBe(
      'https://cn.bing.com/search?q=999.1.1.1'
    )
  })
  it('keeps userinfo in the address instead of rewriting the host', function () {
    expect(isUrlKeyword('https://evil.com@bank.com')).toBe(true)
    expect(parseKeywordUrl('https://evil.com@bank.com')).toBe('https://evil.com@bank.com')
    expect(findAddressUrl('https://evil.com@bank.com', ENGINES[0].match)).toBe(
      'https://evil.com@bank.com'
    )
  })

  it('skips the first row when the keyword itself is a url', function () {
    expect(findDefaultNavigation('example.com')).toBe(ENGINE_UI.NONE)
    expect(findDefaultNavigation('rust')).toBe(0)
  })
})
