import { describe, expect, it } from 'vitest'

import { CLOSED_LIMIT, dropClosed, parseTabs, rememberClosed, type Tab } from '@/views/navigation/session'

function tab(id: string, url = `https://${id}.example`): Tab {
  return { id, url, title: id }
}

describe('parseTabs', function () {
  it('keeps the saved active tab and drops a broken row', function () {
    const parsed = parseTabs({
      tabs: [tab('a'), { id: 1 }, tab('b')],
      activeId: 'b',
      searches: ['  rust  ', 'rust', ''],
      closed: [{ id: 'c', url: 'https://c.example', title: 'c', index: 1 }]
    })
    expect(parsed.tabs.map(function (item) {
      return item.id
    })).toEqual(['a', 'b'])
    expect(parsed.activeId).toBe('b')
    expect(parsed.searches).toEqual(['rust'])
    expect(parsed.closed).toEqual([{ id: 'c', url: 'https://c.example', title: 'c', index: 1 }])
  })

  it('reads a legacy session that has no closed tabs', function () {
    const parsed = parseTabs({ tabs: [tab('a')], activeId: 'missing' })
    expect(parsed.activeId).toBe('a')
    expect(parsed.closed).toEqual([])
    expect(parsed.searches).toEqual([])
  })
})

describe('rememberClosed', function () {
  it('skips an empty tab and keeps the newest close first', function () {
    const first = rememberClosed([], tab('a'), 2)
    const withEmpty = rememberClosed(first, { id: 'empty', url: '', title: '新标签' }, 0)
    const next = rememberClosed(withEmpty, tab('b'), 0)
    expect(next.map(function (item) {
      return item.id
    })).toEqual(['b', 'a'])
    expect(dropClosed(next, 'b')).toEqual(first)
  })

  it('caps the closed ring', function () {
    let closed = rememberClosed([], tab('seed'), 0)
    for (let i = 0; i < CLOSED_LIMIT + 3; i += 1) {
      closed = rememberClosed(closed, tab(`t${i}`), i)
    }
    expect(closed).toHaveLength(CLOSED_LIMIT)
    expect(closed[0]?.id).toBe(`t${CLOSED_LIMIT + 2}`)
  })
})
