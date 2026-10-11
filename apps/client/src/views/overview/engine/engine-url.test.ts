import { describe, expect, it } from 'vitest'

import { ENGINES } from '@/constants/engine'
import { ENGINE_UI } from '@/views/overview/engine/engine-constants'
import {
  buildSuggestionUrl,
  findDefaultNavigation,
  findItemUrl,
  isUrlKeyword,
  parseKeywordUrl,
  parseSuggestionLabel
} from '@/views/overview/engine/engine-url'

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

  it('skips the first row when the keyword itself is a url', function () {
    expect(findDefaultNavigation('example.com')).toBe(ENGINE_UI.NONE)
    expect(findDefaultNavigation('rust')).toBe(0)
  })
})
