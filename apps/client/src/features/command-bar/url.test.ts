import { describe, expect, it } from 'vitest'

import { ENGINES } from '@/constants/engine'
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import {
  buildSuggestionUrl,
  findAddressUrl,
  findDefaultNavigation,
  findItemUrl,
  isUrlKeyword,
  parseKeywordUrl,
  parseSuggestionLabel
} from '@/features/command-bar/url'

describe('command-bar url', function () {
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
    expect(findAddressUrl('rust lang', ENGINES[0].match)).toBe(
      `${ENGINES[0].match}${encodeURIComponent('rust lang')}`
    )
  })

  it('defaults navigation index for url vs query', function () {
    expect(findDefaultNavigation('example.com')).toBe(OMNIBAR_UI.NONE)
    expect(findDefaultNavigation('hello')).toBe(0)
  })
})
