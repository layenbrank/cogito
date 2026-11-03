import { beforeEach, describe, expect, it, vi } from 'vitest'

const patchPref = vi.fn(async function () {})
let visits: Array<{ url: string; title: string; visitedAt: number }> = []

vi.mock('@/features/persist', function () {
  return {
    findPref: function () {
      return { browserVisits: visits }
    },
    patchPref: function (_ns: string, patch: { browserVisits?: typeof visits }) {
      if (patch.browserVisits) visits = patch.browserVisits
      return patchPref(_ns, patch)
    }
  }
})

vi.mock('@/features/persist/defaults', function () {
  return { BROWSER_VISIT_CAP: 3 }
})

import { matchBrowserVisits, readBrowserVisits, recordBrowserVisit } from './visit-history'

describe('visit-history', function () {
  beforeEach(function () {
    visits = []
    patchPref.mockClear()
  })

  it('写入并去重置顶', async function () {
    await recordBrowserVisit('https://a.test/', 'A')
    await recordBrowserVisit('https://b.test/', 'B')
    await recordBrowserVisit('https://a.test/', 'A2')
    expect(readBrowserVisits().map(function (item) {
      return item.url
    })).toEqual(['https://a.test/', 'https://b.test/'])
    expect(readBrowserVisits()[0].title).toBe('A2')
  })

  it('忽略 about:blank', async function () {
    await recordBrowserVisit('about:blank', '')
    expect(readBrowserVisits()).toEqual([])
  })

  it('按关键词匹配', async function () {
    visits = [
      { url: 'https://rust-lang.org/', title: 'Rust', visitedAt: 2 },
      { url: 'https://example.com/', title: 'Example', visitedAt: 1 }
    ]
    expect(matchBrowserVisits('rust')).toHaveLength(1)
    expect(matchBrowserVisits('')).toHaveLength(2)
  })
})
