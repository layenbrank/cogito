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

vi.mock('@/features/browser/visit-history', function () {
  return {
    matchBrowserVisits: function (query: string) {
      const all = [
        { url: 'https://docs.rs/', title: 'docs.rs', visitedAt: 3 },
        { url: 'https://rust-lang.org/', title: 'Rust', visitedAt: 2 },
        { url: 'https://example.com/other', title: 'Other', visitedAt: 1 }
      ]
      const needle = query.trim().toLowerCase()
      if (!needle) return all
      return all.filter(function (item) {
        return item.title.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle)
      })
    }
  }
})

vi.mock('@/stores/mirror', function () {
  return {
    useMirrorStore: {
      getState: function () {
        return {
          magneticTiles: [
            {
              id: 'tile-1',
              component: 'navigation',
              title: 'GitHub',
              url: 'https://github.com/',
              description: ''
            },
            {
              id: 'tile-2',
              component: 'collection',
              title: 'Not nav',
              url: 'https://nope.test/',
              description: ''
            }
          ]
        }
      }
    }
  }
})

import {
  findInstantOmniboxSuggestions,
  findLocalOmniboxSuggestions,
  findRemoteOmniboxSuggestions,
  findSessionOmniboxSuggestions,
  mergeOmniboxSuggestions,
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

describe('findLocalOmniboxSuggestions', function () {
  it('空查询返回最近历史与导航磁贴', function () {
    const rows = findLocalOmniboxSuggestions('')
    expect(rows.some(function (row) {
      return row.subtitle === '历史记录'
    })).toBe(true)
    expect(rows.some(function (row) {
      return row.target.url === 'https://github.com/'
    })).toBe(true)
  })

  it('按关键词过滤历史', function () {
    const rows = findLocalOmniboxSuggestions('rust')
    expect(rows.every(function (row) {
      return row.title.toLowerCase().includes('rust') || row.target.url.includes('rust')
    })).toBe(true)
  })
})

describe('findSessionOmniboxSuggestions', function () {
  it('映射会话历史条目', async function () {
    const rows = await findSessionOmniboxSuggestions('a', [
      { url: 'https://a.test/', title: 'A' },
      { url: 'https://b.test/', title: 'B' }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].subtitle).toBe('本页历史')
  })
})

describe('mergeOmniboxSuggestions', function () {
  it('按 URL 去重且保留即时优先', function () {
    const instant = findInstantOmniboxSuggestions('docs.rs')
    const local = findLocalOmniboxSuggestions('docs')
    const merged = mergeOmniboxSuggestions(instant, local, [], [])
    const docsNav = merged.filter(function (row) {
      return row.target.kind === 'url' && row.target.url.includes('docs.rs')
    })
    expect(docsNav).toHaveLength(1)
    expect(docsNav[0].subtitle).toBe('打开网址')
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
