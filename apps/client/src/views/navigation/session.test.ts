import { describe, expect, it } from 'vitest'

import { parseTabs, type Tab } from '@/views/navigation/session'

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
    expect(parsed).not.toHaveProperty('closed')
  })

  it('reads a legacy session that has no searches', function () {
    const parsed = parseTabs({ tabs: [tab('a')], activeId: 'missing' })
    expect(parsed).toEqual({
      tabs: [tab('a')],
      activeId: 'a',
      searches: []
    })
  })

  it('caps searches at twenty unique strings', function () {
    const searches = [' q0 ']
    for (let index = 0; index < 25; index += 1) {
      searches.push(`q${index}`)
    }
    const parsed = parseTabs({ tabs: [], activeId: '', searches })
    expect(parsed.searches).toHaveLength(20)
    expect(parsed.searches[0]).toBe('q0')
    expect(parsed.searches[19]).toBe('q19')
  })
})
