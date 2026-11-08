import { describe, expect, it } from 'vitest'

import { buildThreadItemIndex, findIndexedThreadItem } from './thread-items'

describe('buildThreadItemIndex', function () {
  it('indexes an array by both id and remoteId', function () {
    const index = buildThreadItemIndex([
      { id: '__LOCALID_1', remoteId: 'r1', title: 'A' },
      { id: 'r2', remoteId: 'r2', title: 'B' }
    ])
    expect(findIndexedThreadItem(index, '__LOCALID_1')?.title).toBe('A')
    expect(findIndexedThreadItem(index, 'r1')?.title).toBe('A')
    expect(findIndexedThreadItem(index, 'r2')?.title).toBe('B')
    expect(findIndexedThreadItem(index, 'missing')).toBeNull()
  })

  it('accepts the id → item record shape too', function () {
    const index = buildThreadItemIndex({
      t1: { id: 't1', remoteId: 'r1', title: 'A' },
      t2: { id: 't2', title: 'B' }
    })
    expect(findIndexedThreadItem(index, 't1')?.title).toBe('A')
    expect(findIndexedThreadItem(index, 'r1')?.title).toBe('A')
    expect(findIndexedThreadItem(index, 't2')?.title).toBe('B')
  })

  it('keeps the id lookup when two items share a remoteId', function () {
    const index = buildThreadItemIndex([
      { id: '__LOCALID_1', remoteId: 'same', title: 'local' },
      { id: 'same', remoteId: 'same', title: 'persisted' }
    ])
    expect(findIndexedThreadItem(index, '__LOCALID_1')?.title).toBe('local')
    expect(findIndexedThreadItem(index, 'same')?.title).toBe('local')
  })

  it('tolerates junk entries without throwing', function () {
    const index = buildThreadItemIndex([null, undefined, { title: 'no id' }])
    expect(findIndexedThreadItem(index, 'x')).toBeNull()
    expect(buildThreadItemIndex(null).size).toBe(0)
    expect(buildThreadItemIndex('nope').size).toBe(0)
  })
})
