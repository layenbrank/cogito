import { describe, expect, it } from 'vitest'

import { moveTile } from './order'

describe('moveTile', function () {
  it('把磁贴插到目标位置', function () {
    expect(moveTile(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(moveTile(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('同一项或找不到时保持原顺序', function () {
    expect(moveTile(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(moveTile(['a'], 'missing', 'a')).toEqual(['a'])
  })
})
