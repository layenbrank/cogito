import { describe, expect, it } from 'vitest'

import { uniqueBy, uniqueByStrategies } from '@/features/command-bar/unique'

describe('command-bar unique', function () {
  it('uniqueBy keeps first occurrence', function () {
    const items = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'a', n: 3 }
    ]
    expect(
      uniqueBy(items, function (item) {
        return item.id
      })
    ).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 }
    ])
  })

  it('uniqueByStrategies chains keys', function () {
    const items = [
      { id: '1', title: '书签' },
      { id: '2', title: '书签' },
      { id: '3', title: '代码' }
    ]
    const next = uniqueByStrategies(items, [
      function (item) {
        return item.id
      },
      function (item) {
        return item.title
      }
    ])
    expect(next).toEqual([
      { id: '1', title: '书签' },
      { id: '3', title: '代码' }
    ])
  })
})
