import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/command-bar/store', function () {
  return {
    readEngineKey: function () {
      return 'bing'
    }
  }
})

vi.mock('@/lib/engine-ipc', function () {
  return {
    EngineIpc: {
      suggestion: vi.fn(async function () {
        return {
          s: [
            { q: 'rust lang', u: '/search?q=rust+lang', id: '1' },
            { q: 'rustc', u: '/search?q=rustc', id: '2' }
          ],
          i: { ig: '' }
        }
      })
    }
  }
})

import {
  findInstantOmniboxSuggestions,
  findRemoteOmniboxSuggestions,
  resolveOmnibox
} from './omnibox'

describe('resolveOmnibox', function () {
  it('网址形态走导航', function () {
    expect(resolveOmnibox('example.com')?.kind).toBe('url')
    expect(resolveOmnibox('example.com')?.url).toBe('https://example.com')
    expect(resolveOmnibox('https://a.test/x')?.url).toBe('https://a.test/x')
    expect(resolveOmnibox('localhost:3000')?.url).toBe('http://localhost:3000')
  })

  it('带空格或非 URL 走搜索', function () {
    const hit = resolveOmnibox('rust ownership')
    expect(hit?.kind).toBe('search')
    expect(hit?.url).toContain('cn.bing.com/search?q=')
    expect(hit?.url).toContain(encodeURIComponent('rust ownership'))
  })

  it('about: 仍当地址', function () {
    expect(resolveOmnibox('about:blank')).toEqual({
      kind: 'url',
      url: 'about:blank',
      label: 'about:blank'
    })
  })
})

describe('findInstantOmniboxSuggestions', function () {
  it('URL 输入同时给出打开与搜索', function () {
    const rows = findInstantOmniboxSuggestions('example.com')
    expect(rows.map(function (row) {
      return row.target.kind
    })).toEqual(['url', 'search'])
  })

  it('搜索词只有搜索行', function () {
    const rows = findInstantOmniboxSuggestions('hello world')
    expect(rows).toHaveLength(1)
    expect(rows[0].target.kind).toBe('search')
  })
})

describe('findRemoteOmniboxSuggestions', function () {
  beforeEach(function () {
    vi.clearAllMocks()
  })

  it('把 Bing AS 映射成建议行', async function () {
    const rows = await findRemoteOmniboxSuggestions('rust', new AbortController().signal)
    expect(rows.length).toBe(2)
    expect(rows[0].title).toBe('rust lang')
    expect(rows[0].target.url).toContain('cn.bing.com')
  })
})
